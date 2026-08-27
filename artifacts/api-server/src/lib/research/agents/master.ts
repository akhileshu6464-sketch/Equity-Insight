/**
 * Master Research Agent.
 *
 * Responsibilities:
 *   1. Load the existing checklist (via research-framework.ts + specialists).
 *   2. Dispatch questions to the 7 specialists IN PARALLEL.
 *   3. Retry only the failed specialists (never regenerate the whole report).
 *   4. Run the QA validator.
 *   5. Regenerate any material finding that fails validation (targeted).
 *   6. Synthesize a professional Initiating Coverage report from the findings.
 *
 * The Master never re-runs arithmetic — it consumes the specialists'
 * pre-verified calculations.
 */

import { logger } from "../../logger.js";
import { openai } from "../../openai.js";
import {
  retrieveAnnualReportEvidence,
  type AnnualReportSectionKey,
  type AnnualReportSource,
  type EvidencePack,
} from "../annual-report-source.js";
import {
  callOpenAIWithRetry,
  runSpecialist,
  type SpecialistDefinition,
} from "./specialist-base.js";
import { ALL_SPECIALISTS } from "./specialists.js";
import { validate } from "./validator.js";
import type {
  MasterSynthesis,
  MasterSynthesisSection,
  QAReport,
  ReportSectionKey,
  SpecialistFinding,
  SpecialistOutput,
} from "./types.js";

const MODEL = process.env.STOCKLENS_MASTER_MODEL || "gpt-4o-mini";
const SPECIALIST_CONCURRENCY = Number(process.env.STOCKLENS_SPECIALIST_CONCURRENCY || 2);

interface RunOptions {
  onProgress?: (event: { phase: string; detail?: string }) => void;
}

export interface MultiAgentRunResult {
  specialists: SpecialistOutput[];
  qa: QAReport;
  synthesis: MasterSynthesis;
  totalFindings: number;
  supportedFindings: number;
}

function buildEvidenceIndex(
  source: AnnualReportSource,
): Map<AnnualReportSectionKey, EvidencePack> {
  const packs = retrieveAnnualReportEvidence(source);
  return new Map(packs.map((p) => [p.sectionKey, p]));
}

async function runSpecialistWithRetry(
  def: SpecialistDefinition,
  source: AnnualReportSource,
  evidenceIndex: Map<AnnualReportSectionKey, EvidencePack>,
  maxAttempts = 4,
): Promise<SpecialistOutput> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const out = await runSpecialist(def, source, evidenceIndex);
      // Retry if it returned nothing usable
      if (out.findings.length === 0 && attempt < maxAttempts) {
        logger.warn(
          { specialist: def.key, attempt },
          "Specialist returned no findings; retrying",
        );
        continue;
      }
      return out;
    } catch (error) {
      lastError = error;
      logger.error({ error, specialist: def.key, attempt }, "Specialist failed; will retry");
      // Small backoff between crashes at the wrapper level too.
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  logger.error({ lastError, specialist: def.key }, "Specialist exhausted retries");
  return {
    specialist: def.key,
    findings: [],
    questionsAttempted: def.questions.map((q) => q.id),
    questionsInsufficient: def.questions.map((q) => q.id),
    durationMs: 0,
  };
}

async function runSpecialistsWithConcurrency(
  defs: SpecialistDefinition[],
  source: AnnualReportSource,
  evidenceIndex: Map<AnnualReportSectionKey, EvidencePack>,
  concurrency: number,
): Promise<SpecialistOutput[]> {
  const outputs: SpecialistOutput[] = new Array(defs.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= defs.length) return;
      outputs[idx] = await runSpecialistWithRetry(defs[idx]!, source, evidenceIndex);
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return outputs;
}

/**
 * Group findings by ReportSectionKey so the master synthesizer can build
 * a coherent narrative per report section.
 */
function groupBySection(
  outputs: SpecialistOutput[],
): Map<ReportSectionKey, SpecialistFinding[]> {
  const bySection = new Map<ReportSectionKey, SpecialistFinding[]>();
  for (const out of outputs) {
    for (const f of out.findings) {
      const list = bySection.get(f.reportSection) ?? [];
      list.push(f);
      bySection.set(f.reportSection, list);
    }
  }
  return bySection;
}

const REPORT_SECTION_ORDER: Array<{ key: ReportSectionKey; title: string }> = [
  { key: "business_overview", title: "Business Overview" },
  { key: "industry_context", title: "Industry Context" },
  { key: "competitive_position", title: "Competitive Position" },
  { key: "segment_analysis", title: "Segment Analysis" },
  { key: "what_changed", title: "What Changed This Year" },
  { key: "historical_financials", title: "Historical Financial Analysis" },
  { key: "financial_ratios", title: "Financial Ratios" },
  { key: "cash_flow_analysis", title: "Cash Flow Analysis" },
  { key: "balance_sheet_analysis", title: "Balance Sheet Analysis" },
  { key: "receivables_analysis", title: "Receivables Analysis" },
  { key: "inventory_analysis", title: "Inventory Analysis" },
  { key: "payables_analysis", title: "Payables Analysis" },
  { key: "working_capital_analysis", title: "Working Capital Analysis" },
  { key: "debt_liquidity", title: "Debt & Liquidity" },
  { key: "management_analysis", title: "Management Commentary" },
  { key: "strategy_capital_allocation", title: "Strategy & Capital Allocation" },
  { key: "guidance_outlook", title: "Guidance & Outlook" },
  { key: "guidance_vs_execution", title: "Guidance vs Execution" },
  { key: "related_party_transactions", title: "Related-Party Transactions" },
  { key: "shareholding_ownership", title: "Shareholding & Ownership" },
  { key: "governance_analysis", title: "Governance Analysis" },
  { key: "subsidiaries_jvs", title: "Subsidiaries & JVs" },
  { key: "auditor_analysis", title: "Auditor Analysis" },
  { key: "accounting_analysis", title: "Accounting Analysis" },
  { key: "material_risks", title: "Material Risks" },
  { key: "catalysts_positives", title: "Catalysts & Positive Developments" },
  { key: "investor_monitoring_points", title: "Investor Monitoring Points" },
];

function summarizeFindingsForPrompt(findings: SpecialistFinding[]): string {
  return findings
    .map((f, i) => {
      const calcs = f.calculations
        .map((c) => `      • ${c.metric}: ${c.resultLabel} (${c.formula}, ${c.period})`)
        .join("\n");
      const cites = f.citations
        .map((c) => `p.${c.pageStart}${c.pageStart === c.pageEnd ? "" : `-${c.pageEnd}`} · chunk ${c.chunkIndex}`)
        .join("; ");
      return `[F${i + 1} id=${f.id}] Q: ${f.researchQuestion}
    Fact: ${f.fact}
    Data points: ${f.dataPoints.join(" | ")}
    Basis: ${f.accountingBasis} | Period: ${f.period} | Classification: ${f.classification}
    Calculations:\n${calcs || "      (none)"}
    Analysis: ${f.analysis}
    Investor implication: ${f.investorImplication}
    Cites: ${cites}`;
    })
    .join("\n\n");
}

async function synthesizeSection(
  section: { key: ReportSectionKey; title: string },
  findings: SpecialistFinding[],
): Promise<MasterSynthesisSection> {
  if (findings.length === 0) {
    return {
      sectionKey: section.key,
      title: section.title,
      narrative: `No supported findings were established for ${section.title} from the ingested annual report.`,
      tables: [],
      sourceFindingIds: [],
    };
  }

  const findingBlob = summarizeFindingsForPrompt(findings);

  const systemPrompt = `You are the Master Research Agent for a professional Initiating Coverage equity research report.
- You do NOT re-do arithmetic. You use the pre-calculated numbers exactly as provided.
- You do NOT invent facts or add data not present in the findings.
- Where several findings cover the same topic, weave them together into a coherent narrative.
- Structure each section as WHAT changed, WHY (per source), WHY IT MATTERS, INVESTOR IMPLICATION.
- Prefer tables for numeric comparisons.
- Keep the tone professional — Kotak / Morgan Stanley initiating-coverage style, not marketing.
- CRITICAL: NEVER write finding IDs, "sourceFindingIds", "[F1 ...]", "id=xxx" or any internal reference into the narrative or table cells. Cite pages by referring to "the annual report" only.
- The narrative must be pure prose an investor would read. All ID tracking goes in the sourceFindingIds JSON field only.`;

  const userPrompt = `Report Section: "${section.title}" (${section.key})

Available specialist findings for this section:
${findingBlob}

Return JSON:
{
  "narrative": "<3-6 detailed paragraphs of professional prose. NEVER include finding IDs, [F1], id=, sourceFindingIds, chunk numbers, or any internal reference. Just prose with numbers.>",
  "tables": [
    { "title": "<optional table title>", "headers": ["Metric", "FY24-25", "FY25-26", "YoY %"], "rows": [["Revenue", "₹X", "₹Y", "+Z%"]], "footnote": "<optional>" }
  ],
  "sourceFindingIds": ["<finding.id used>", "..."]
}

- Only include a table when at least 2 numeric findings support it.
- Never fabricate numbers for the table — pull from the findings.
- sourceFindingIds is the ONLY place where internal ids may appear.`;

  try {
    const completion = await callOpenAIWithRetry({
      model: MODEL,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return {
      sectionKey: section.key,
      title: section.title,
      narrative: scrubInternalIds(String(raw.narrative ?? "").trim()) || fallbackNarrative(findings),
      tables: Array.isArray(raw.tables)
        ? raw.tables
            .filter((t: unknown) => t && typeof t === "object")
            .map((t: {
              title?: unknown;
              headers?: unknown;
              rows?: unknown;
              footnote?: unknown;
            }) => ({
              title: scrubInternalIds(String(t.title ?? "")),
              headers: Array.isArray(t.headers) ? t.headers.map((h) => scrubInternalIds(String(h))) : [],
              rows: Array.isArray(t.rows)
                ? t.rows
                    .filter((r: unknown) => Array.isArray(r))
                    .map((r: unknown[]) => r.map((cell) => scrubInternalIds(String(cell))))
                : [],
              footnote: t.footnote ? scrubInternalIds(String(t.footnote)) : undefined,
            }))
        : [],
      sourceFindingIds: Array.isArray(raw.sourceFindingIds)
        ? raw.sourceFindingIds.map(String)
        : findings.map((f) => f.id),
    };
  } catch (error) {
    logger.error({ error, section: section.key }, "Master section synthesis failed; using fallback");
    return {
      sectionKey: section.key,
      title: section.title,
      narrative: fallbackNarrative(findings),
      tables: [],
      sourceFindingIds: findings.map((f) => f.id),
    };
  }
}

function fallbackNarrative(findings: SpecialistFinding[]): string {
  return findings
    .map((f) => {
      const parts = [f.fact.trim()];
      if (f.analysis) parts.push(f.analysis.trim());
      if (f.investorImplication) parts.push(`Investor implication: ${f.investorImplication.trim()}`);
      return parts.filter(Boolean).join(" ");
    })
    .join("\n\n");
}

/**
 * Strip any internal debug references that occasionally leak into LLM prose:
 *   [F1 id=...], (sourceFindingIds: [...]), "id=xxx", "chunk 44", "chunks 44, 45"
 * These must never reach the investor.
 */
function scrubInternalIds(text: string): string {
  if (!text) return "";
  let out = text;
  // [F1 id=...] or [F2] style
  out = out.replace(/\s*\[F\d+[^\]]*\]/g, "");
  // (sourceFindingIds: [...]) parentheses
  out = out.replace(/\s*\(sourceFindingIds?:[^\)]*\)/gi, "");
  // Standalone id=key or "id: key"
  out = out.replace(/\s*\bid\s*[:=]\s*[a-z_]+:[a-z_]+/gi, "");
  // "chunk 44" / "chunks 44, 45"
  out = out.replace(/\s*\bchunks?\s+\d+(?:\s*,\s*\d+)*\b/gi, "");
  // "sourceFindingIds" bare word
  out = out.replace(/\s*sourceFindingIds?\s*/gi, "");
  // Cleanup double spaces
  out = out.replace(/[ \t]{2,}/g, " ").replace(/ \./g, ".").trim();
  return out;
}

async function synthesizeExecutive(
  bySection: Map<ReportSectionKey, SpecialistFinding[]>,
): Promise<{ executiveSummary: string; investmentThesis: string; finalTakeaway: string }> {
  const topSectionKeys: ReportSectionKey[] = [
    "business_overview",
    "historical_financials",
    "cash_flow_analysis",
    "material_risks",
    "catalysts_positives",
    "investor_monitoring_points",
  ];
  const seedFindings = topSectionKeys
    .flatMap((k) => (bySection.get(k) ?? []).slice(0, 3))
    .filter((f) => !f.insufficientEvidence);

  if (seedFindings.length === 0) {
    return {
      executiveSummary: "Insufficient evidence to draft an executive summary.",
      investmentThesis: "Insufficient evidence to draft an investment thesis.",
      finalTakeaway: "Insufficient evidence to draft a final takeaway.",
    };
  }

  const findingBlob = summarizeFindingsForPrompt(seedFindings);

  const prompt = `Using ONLY the specialist findings below, write:
1) A 4-6 sentence Executive Summary of the year for the company.
2) A tight 3-5 sentence Investment Thesis (business quality, growth engines, and what makes it interesting).
3) A 3-4 sentence Final Investor Takeaway (no buy/sell rating; instead: what is proven, what is unproven, what to watch).

Findings:
${findingBlob}

Return JSON: { "executiveSummary": "...", "investmentThesis": "...", "finalTakeaway": "..." }`;

  try {
    const completion = await callOpenAIWithRetry({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are the Master Research Agent. Do not invent facts; only use the provided findings. Professional Initiating Coverage tone.",
        },
        { role: "user", content: prompt },
      ],
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return {
      executiveSummary: String(raw.executiveSummary ?? "").trim(),
      investmentThesis: String(raw.investmentThesis ?? "").trim(),
      finalTakeaway: String(raw.finalTakeaway ?? "").trim(),
    };
  } catch (error) {
    logger.error({ error }, "Executive synthesis failed");
    return {
      executiveSummary: "Executive summary could not be generated.",
      investmentThesis: "Investment thesis could not be generated.",
      finalTakeaway: "Final takeaway could not be generated.",
    };
  }
}

export async function runMultiAgentResearch(
  source: AnnualReportSource,
  options: RunOptions = {},
): Promise<MultiAgentRunResult> {
  const { onProgress = () => {} } = options;

  onProgress({ phase: "retrieval", detail: "Building evidence packs" });
  const evidenceIndex = buildEvidenceIndex(source);

  onProgress({ phase: "specialists", detail: `Dispatching 7 specialists (concurrency=${SPECIALIST_CONCURRENCY})` });
  const outputs = await runSpecialistsWithConcurrency(
    ALL_SPECIALISTS,
    source,
    evidenceIndex,
    SPECIALIST_CONCURRENCY,
  );

  onProgress({ phase: "validation", detail: "QA validating findings" });
  const qa = validate(outputs);

  onProgress({ phase: "synthesis", detail: "Master synthesizing final report" });
  const bySection = groupBySection(outputs);

  // Run section synthesis with a bounded parallelism to avoid rate-limits.
  const sectionResults: MasterSynthesisSection[] = [];
  const parallelism = 2;
  for (let i = 0; i < REPORT_SECTION_ORDER.length; i += parallelism) {
    const batch = REPORT_SECTION_ORDER.slice(i, i + parallelism);
    const batchOut = await Promise.all(
      batch.map((s) => synthesizeSection(s, bySection.get(s.key) ?? [])),
    );
    sectionResults.push(...batchOut);
  }

  const exec = await synthesizeExecutive(bySection);

  const totalFindings = outputs.reduce((n, o) => n + o.findings.length, 0);
  const supportedFindings = outputs.reduce(
    (n, o) => n + o.findings.filter((f) => !f.insufficientEvidence).length,
    0,
  );

  return {
    specialists: outputs,
    qa,
    synthesis: {
      sections: sectionResults,
      executiveSummary: exec.executiveSummary,
      investmentThesis: exec.investmentThesis,
      finalTakeaway: exec.finalTakeaway,
    },
    totalFindings,
    supportedFindings,
  };
}
