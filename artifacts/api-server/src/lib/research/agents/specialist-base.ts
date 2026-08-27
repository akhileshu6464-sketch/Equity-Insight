/**
 * Base runner for specialist research agents.
 *
 * A specialist is defined by:
 *   - A list of research questions to answer (from the existing checklist framework)
 *   - The set of evidence section keys it draws from (targeted retrieval)
 *   - A specialty (e.g., "financial analysis of an equity research report")
 *
 * The runner performs:
 *   1. Assemble focused evidence pack (chunks + line-anchored excerpts)
 *   2. Call OpenAI with a strict JSON-schema prompt
 *   3. Parse & validate each finding against evidence (numeric grounding)
 *   4. Return SpecialistOutput
 *
 * The LLM is NEVER trusted for arithmetic. It only proposes number pairs from
 * the source; downstream calculator.ts computes derived metrics.
 */

import { openai } from "../../openai.js";
import { logger } from "../../logger.js";
import { AI_RULES } from "../../evidence.js";
import {
  formatEvidencePack,
  type AnnualReportSectionKey,
  type AnnualReportSource,
  type EvidencePack,
} from "../annual-report-source.js";
import type {
  AccountingBasis,
  ValidatedCitation,
} from "../annual-report-types.js";
import type {
  SpecialistFinding,
  SpecialistKey,
  SpecialistOutput,
  ReportSectionKey,
  CalculationRecord,
} from "./types.js";

const SPECIALIST_MODEL = process.env.STOCKLENS_SPECIALIST_MODEL || "gpt-4o-mini";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(err: unknown): number | null {
  const anyErr = err as { message?: string; status?: number } | undefined;
  if (!anyErr) return null;
  if (anyErr.status !== 429) return null;
  const msg = typeof anyErr.message === "string" ? anyErr.message : "";
  const match = msg.match(/try again in ([0-9.]+)s/i);
  if (match) {
    const s = Number(match[1]);
    if (Number.isFinite(s)) return s;
  }
  return null;
}

export async function callOpenAIWithRetry(
  params: Parameters<typeof openai.chat.completions.create>[0],
  maxAttempts = 5,
) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await openai.chat.completions.create(params);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      // Retry only on rate-limit or transient errors
      if (status !== 429 && (status ?? 0) < 500) throw err;
      const retryAfter = parseRetryAfterSeconds(err);
      const backoffMs = retryAfter
        ? Math.ceil(retryAfter * 1000) + 1000
        : Math.min(30000, 2000 * 2 ** (attempt - 1));
      logger.warn(
        { attempt, backoffMs, status },
        "OpenAI transient error — sleeping before retry",
      );
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

export interface SpecialistDefinition {
  key: SpecialistKey;
  specialty: string;
  systemPrompt: string;
  /** Which existing evidence packs to feed this specialist */
  evidenceSectionKeys: AnnualReportSectionKey[];
  /** Research questions the specialist must attempt (from the master checklist) */
  questions: SpecialistQuestion[];
  /** Number of parallel LLM calls to make (batches the questions) */
  batchSize?: number;
}

export interface SpecialistQuestion {
  id: string;
  reportSection: ReportSectionKey;
  question: string;
  /** Extra instruction just for this question (calculations expected, etc.) */
  guidance?: string;
}

interface RawFindingFromLLM {
  question_id?: string;
  research_question?: string;
  fact?: string;
  data_points?: unknown;
  supporting_quote?: string;
  evidence_ids?: unknown;
  accounting_basis?: string;
  period?: string;
  classification?: string;
  confidence?: string;
  analysis?: string;
  investor_implication?: string;
  insufficient_evidence?: boolean;
  insufficient_reason?: string;
  proposed_calculations?: unknown;
}

interface ProposedCalculation {
  metric: string;
  formula: string;
  inputs: Array<{
    label: string;
    value: number;
    unit?: string;
    period: string;
    basis: string;
  }>;
  result: number;
  result_label: string;
}

const ALLOWED_BASES: AccountingBasis[] = [
  "CONSOLIDATED",
  "STANDALONE",
  "NOT_CLEAR",
  "NOT_APPLICABLE",
];

function coerceBasis(raw: unknown): AccountingBasis {
  const value = String(raw ?? "").toUpperCase().trim();
  return (ALLOWED_BASES as string[]).includes(value)
    ? (value as AccountingBasis)
    : "NOT_CLEAR";
}

function coerceClassification(raw: unknown): "FACT" | "INFERENCE" | "UNCERTAIN" {
  const v = String(raw ?? "").toUpperCase().trim();
  if (v === "FACT" || v === "INFERENCE" || v === "UNCERTAIN") return v;
  return "INFERENCE";
}

function coerceConfidence(raw: unknown): "HIGH" | "MEDIUM" | "LOW" {
  const v = String(raw ?? "").toUpperCase().trim();
  if (v === "HIGH" || v === "MEDIUM" || v === "LOW") return v;
  return "MEDIUM";
}

function coerceStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%₹]+/g, " ").replace(/\s+/g, " ").trim();
}

function numericTokens(value: string): string[] {
  const tokens = value.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  return tokens.map((token) => token.replace(/,/g, ""));
}

function validateCitations(
  evidenceIds: string[],
  pack: EvidencePack,
): { citations: ValidatedCitation[]; excerpt: string } {
  const unitById = new Map(pack.units.map((u) => [u.id, u]));
  const unitsByChunk = new Map<number, typeof pack.units>();
  for (const u of pack.units) {
    const list = unitsByChunk.get(u.chunkIndex) ?? [];
    list.push(u);
    unitsByChunk.set(u.chunkIndex, list);
  }

  const seen = new Map<number, ValidatedCitation>();
  const excerptParts: string[] = [];
  const usedUnitIds = new Set<string>();

  for (const rawId of evidenceIds) {
    const id = String(rawId).trim();
    // 1) Try exact line-anchored match: "44:12-13"
    const unit = unitById.get(id);
    if (unit) {
      seen.set(unit.chunkIndex, {
        chunkIndex: unit.chunkIndex,
        pageStart: unit.pageStart,
        pageEnd: unit.pageEnd,
        chunkLabel: `Chunk ${unit.chunkIndex}`,
      });
      if (!usedUnitIds.has(unit.id)) {
        excerptParts.push(unit.content);
        usedUnitIds.add(unit.id);
      }
      continue;
    }
    // 2) Try chunk-only match: "44" or "chunk 44"
    const chunkMatch = id.match(/(\d+)/);
    if (chunkMatch) {
      const chunkIndex = Number(chunkMatch[1]);
      const chunkUnits = unitsByChunk.get(chunkIndex);
      if (chunkUnits && chunkUnits.length > 0) {
        const first = chunkUnits[0]!;
        seen.set(first.chunkIndex, {
          chunkIndex: first.chunkIndex,
          pageStart: first.pageStart,
          pageEnd: first.pageEnd,
          chunkLabel: `Chunk ${first.chunkIndex}`,
        });
        // include ALL units from this chunk in the excerpt for grounding
        for (const cu of chunkUnits) {
          if (!usedUnitIds.has(cu.id)) {
            excerptParts.push(cu.content);
            usedUnitIds.add(cu.id);
          }
        }
      }
    }
  }

  return {
    citations: [...seen.values()].sort((a, b) => a.chunkIndex - b.chunkIndex),
    excerpt: excerptParts.join(" \n "),
  };
}

/**
 * Verify every material number the LLM claimed appears in the cited excerpt.
 * Rejects a finding if any claimed number is not verifiable in evidence.
 */
function factuallyGrounded(
  fact: string,
  dataPoints: string[],
  excerpt: string,
): boolean {
  const excerptText = normalizeText(excerpt);
  const excerptNumbers = new Set(numericTokens(excerpt));

  const claimNumbers = [
    ...numericTokens(fact),
    ...dataPoints.flatMap((p) => numericTokens(p)),
  ]
    // filter out year-like tokens
    .filter((n) => !/^(?:19|20)\d{2}$/.test(n) && n.length > 1);

  const numericsOk = claimNumbers.every((n) => excerptNumbers.has(n));
  if (!numericsOk) return false;

  // At least a few meaningful tokens from the fact should appear in the excerpt
  const factTokens = normalizeText(fact)
    .split(" ")
    .filter((t) => t.length > 3);
  if (factTokens.length === 0) return numericsOk;
  const matches = factTokens.filter((t) => excerptText.includes(t)).length;
  return matches >= Math.min(3, factTokens.length);
}

function buildProposedCalculations(
  raw: unknown,
): Array<{ record: CalculationRecord | null; raw: ProposedCalculation }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is ProposedCalculation => {
      if (!item || typeof item !== "object") return false;
      const c = item as ProposedCalculation;
      return typeof c.metric === "string" && typeof c.formula === "string";
    })
    .map((c) => {
      // Only pass through the "record" if the LLM provided finite inputs; the
      // calculator will re-derive from these later. For now we accept the raw
      // result as a candidate — validator will double-check.
      const inputs = Array.isArray(c.inputs) ? c.inputs : [];
      const cleanInputs = inputs
        .filter((i) => i && typeof i === "object" && Number.isFinite(Number(i.value)))
        .map((i) => ({
          label: String(i.label ?? ""),
          value: Number(i.value),
          unit: i.unit ? String(i.unit) : undefined,
          period: String(i.period ?? ""),
          basis: coerceBasis(i.basis),
        }));
      const result = Number(c.result);
      if (!Number.isFinite(result) || cleanInputs.length === 0) {
        return { record: null, raw: c };
      }
      const record: CalculationRecord = {
        metric: c.metric,
        inputs: cleanInputs,
        formula: c.formula,
        result,
        resultLabel: c.result_label ?? String(result),
        period: cleanInputs[0]?.period ?? "",
      };
      return { record, raw: c };
    });
}

const OUTPUT_SCHEMA_HINT = `
Return STRICT JSON with the following shape (no prose, no backticks):

{
  "findings": [
    {
      "question_id": "<id from the questions list>",
      "research_question": "<verbatim question>",
      "fact": "<one-sentence factual statement grounded in the source>",
      "data_points": ["<raw quoted number 1>", "<raw quoted number 2>"],
      "supporting_quote": "<short verbatim excerpt from evidence>",
      "evidence_ids": ["<chunk-line id like 44:12-13>", "..."],
      "accounting_basis": "CONSOLIDATED | STANDALONE | NOT_CLEAR | NOT_APPLICABLE",
      "period": "<e.g., FY2025-26 or FY2024-25 vs FY2025-26>",
      "classification": "FACT | INFERENCE | UNCERTAIN",
      "confidence": "HIGH | MEDIUM | LOW",
      "analysis": "<what changed, why it changed (per source), and why it matters — 2-4 sentences>",
      "investor_implication": "<one-sentence investor takeaway>",
      "insufficient_evidence": false,
      "insufficient_reason": "",
      "proposed_calculations": [
        {
          "metric": "Revenue growth YoY",
          "formula": "(Current − Previous) / Previous × 100",
          "inputs": [
            { "label": "Consolidated revenue FY25-26", "value": 1175919, "unit": "₹cr", "period": "FY2025-26", "basis": "CONSOLIDATED" },
            { "label": "Consolidated revenue FY24-25", "value": 1064348, "unit": "₹cr", "period": "FY2024-25", "basis": "CONSOLIDATED" }
          ],
          "result": 10.48,
          "result_label": "10.5%"
        }
      ]
    }
  ]
}

RULES:
- Only use numeric values that appear verbatim in the provided evidence.
- Every fact must cite at least one evidence_id from the pack.
- NEVER mix CONSOLIDATED and STANDALONE inputs in the same calculation.
- If evidence is insufficient, set insufficient_evidence=true and leave fact empty.
- Never invent a red flag; assess materiality first.
- Prefer specific data points to generic commentary.
- Analysis must include: WHAT changed, WHY it changed (from source), WHY IT MATTERS.
- Investor implication is a single sentence — not a paragraph.
`;

function buildEvidenceBlob(packs: EvidencePack[]): string {
  return packs
    .map(
      (pack) => `# EVIDENCE PACK — ${pack.sectionKey}\n${formatEvidencePack(pack)}`,
    )
    .join("\n\n");
}

function buildQuestionBlob(questions: SpecialistQuestion[]): string {
  return questions
    .map(
      (q) =>
        `- id=${q.id} | section=${q.reportSection} | question="${q.question}"` +
        (q.guidance ? `\n    guidance: ${q.guidance}` : ""),
    )
    .join("\n");
}

async function callSpecialistLLM(
  specialty: string,
  systemPrompt: string,
  evidenceBlob: string,
  questions: SpecialistQuestion[],
): Promise<RawFindingFromLLM[]> {
  const rulesBlob = Object.entries(AI_RULES)
    .map(([key, rule]) => `- ${key}: ${rule}`)
    .join("\n");

  const userPrompt = `You are the ${specialty} specialist in a multi-agent equity research team.

# EXISTING RESEARCH RULES (ALL MUST BE FOLLOWED)
${rulesBlob}

# YOUR RESEARCH QUESTIONS
Answer every question below where evidence permits. Skip only if genuinely insufficient.
${buildQuestionBlob(questions)}

# EVIDENCE
${evidenceBlob}

# OUTPUT
${OUTPUT_SCHEMA_HINT}
`;

  const completion = await callOpenAIWithRetry({
    model: SPECIALIST_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
    return findings as RawFindingFromLLM[];
  } catch (error) {
    logger.error({ error, content: content.slice(0, 400) }, "Specialist LLM returned invalid JSON");
    return [];
  }
}

export async function runSpecialist(
  def: SpecialistDefinition,
  source: AnnualReportSource,
  evidenceBySection: Map<AnnualReportSectionKey, EvidencePack>,
): Promise<SpecialistOutput> {
  const start = Date.now();
  const packs = def.evidenceSectionKeys
    .map((key) => evidenceBySection.get(key))
    .filter((p): p is EvidencePack => Boolean(p));

  if (packs.length === 0) {
    return {
      specialist: def.key,
      findings: [],
      questionsAttempted: def.questions.map((q) => q.id),
      questionsInsufficient: def.questions.map((q) => q.id),
      durationMs: Date.now() - start,
    };
  }

  const evidenceBlob = buildEvidenceBlob(packs);
  const batchSize = def.batchSize ?? 6;
  const findingsOut: SpecialistFinding[] = [];
  const insufficient: string[] = [];

  for (let i = 0; i < def.questions.length; i += batchSize) {
    const batch = def.questions.slice(i, i + batchSize);
    const rawFindings = await callSpecialistLLM(
      def.specialty,
      def.systemPrompt,
      evidenceBlob,
      batch,
    );

    for (const raw of rawFindings) {
      const questionId = String(raw.question_id ?? "").trim();
      const question = batch.find((q) => q.id === questionId);
      if (!question) continue;

      const evidenceIds = coerceStringArray(raw.evidence_ids);
      // Search across ALL packs the specialist has access to for matching evidence.
      // Merge citations from any pack whose units are referenced.
      const allCitations = new Map<number, ValidatedCitation>();
      const allExcerptParts: string[] = [];
      for (const pack of packs) {
        const { citations, excerpt } = validateCitations(evidenceIds, pack);
        for (const c of citations) allCitations.set(c.chunkIndex, c);
        if (excerpt) allExcerptParts.push(excerpt);
      }
      // Fallback: if the LLM gave us a supporting_quote but no valid evidence_ids,
      // search each pack chunk for that quote and derive citations.
      if (allCitations.size === 0 && typeof raw.supporting_quote === "string" && raw.supporting_quote.trim().length > 40) {
        const needle = raw.supporting_quote.slice(0, 80).toLowerCase();
        for (const pack of packs) {
          for (const unit of pack.units) {
            if (unit.content.toLowerCase().includes(needle)) {
              allCitations.set(unit.chunkIndex, {
                chunkIndex: unit.chunkIndex,
                pageStart: unit.pageStart,
                pageEnd: unit.pageEnd,
                chunkLabel: `Chunk ${unit.chunkIndex}`,
              });
              allExcerptParts.push(unit.content);
              break;
            }
          }
        }
      }
      const citations = [...allCitations.values()].sort(
        (a, b) => a.chunkIndex - b.chunkIndex,
      );
      const excerpt = allExcerptParts.join(" \n ");

      const isInsufficient =
        raw.insufficient_evidence === true ||
        !raw.fact ||
        citations.length === 0;

      if (isInsufficient) {
        insufficient.push(question.id);
        findingsOut.push({
          id: `${def.key}:${question.id}`,
          specialist: def.key,
          reportSection: question.reportSection,
          researchQuestion: question.question,
          fact: raw.fact ?? "",
          dataPoints: coerceStringArray(raw.data_points),
          calculations: [],
          analysis: raw.analysis ?? "",
          investorImplication: raw.investor_implication ?? "",
          classification: "UNCERTAIN",
          confidence: "LOW",
          accountingBasis: "NOT_APPLICABLE",
          period: String(raw.period ?? ""),
          citations: [],
          supportingQuote: "",
          insufficientEvidence: true,
          insufficientReason:
            raw.insufficient_reason || "Evidence not sufficient in the ingested source",
        });
        continue;
      }

      const fact = String(raw.fact).trim();
      const dataPoints = coerceStringArray(raw.data_points);
      const grounded = factuallyGrounded(fact, dataPoints, excerpt);

      const proposed = buildProposedCalculations(raw.proposed_calculations);
      const validCalcs: CalculationRecord[] = [];
      for (const p of proposed) {
        if (!p.record) continue;
        const inputsGrounded = p.record.inputs.every((inp) =>
          new Set(numericTokens(excerpt)).has(String(inp.value).replace(/[^\d.-]/g, ""))
          || new Set(numericTokens(excerpt)).has(String(Math.round(inp.value)))
        );
        if (!inputsGrounded) continue;
        const bases = new Set(p.record.inputs.map((i) => i.basis).filter((b) => b !== "NOT_APPLICABLE"));
        if (bases.size > 1) continue;
        validCalcs.push(p.record);
      }

      findingsOut.push({
        id: `${def.key}:${question.id}`,
        specialist: def.key,
        reportSection: question.reportSection,
        researchQuestion: question.question,
        fact,
        dataPoints,
        calculations: validCalcs,
        analysis: String(raw.analysis ?? "").trim(),
        investorImplication: String(raw.investor_implication ?? "").trim(),
        classification: grounded ? coerceClassification(raw.classification) : "UNCERTAIN",
        confidence: grounded ? coerceConfidence(raw.confidence) : "LOW",
        accountingBasis: coerceBasis(raw.accounting_basis),
        period: String(raw.period ?? ""),
        citations,
        supportingQuote: excerpt.slice(0, 900),
        insufficientEvidence: false,
      });
    }

    for (const question of batch) {
      const hasFinding = findingsOut.some((f) => f.id === `${def.key}:${question.id}`);
      if (!hasFinding) insufficient.push(question.id);
    }
  }

  return {
    specialist: def.key,
    findings: findingsOut,
    questionsAttempted: def.questions.map((q) => q.id),
    questionsInsufficient: insufficient,
    durationMs: Date.now() - start,
  };
}
