/**
 * Persist a multi-agent research run into Supabase.
 *
 * We keep the SAME schemas the existing app already uses:
 *   - analysis_evidence  → one row per specialist finding
 *   - research           → one row per report section (with synthesized narrative)
 *   - research_jobs      → track the run
 *
 * We add a new `report_section` value per section key so the frontend can
 * render the full Initiating Coverage report. No new tables are created.
 *
 * We ALSO write to the existing `research` sections so the current frontend
 * shows the deeper multi-agent output without any UI schema changes.
 */

import { logger } from "../../logger.js";
import {
  RELIANCE_COMPANY_ID,
  RELIANCE_REPORTING_PERIOD,
  type AnnualReportSource,
} from "../annual-report-source.js";
import { supabaseRest } from "../supabase-rest.js";
import type {
  MasterSynthesis,
  QAReport,
  SpecialistFinding,
  SpecialistOutput,
} from "./types.js";

function nowIso() {
  return new Date().toISOString();
}

async function deleteRowsByIds(table: string, ids: string[]) {
  if (ids.length === 0) return;
  await supabaseRest<void>(
    "DELETE",
    `/${table}?id=in.(${encodeURIComponent(ids.join(","))})`,
    { prefer: "return=minimal" },
  );
}

async function replaceRows(
  table: string,
  existingPath: string,
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  type Row = { id: string };
  const existing = await supabaseRest<Row[]>(
    "GET",
    `${existingPath}${existingPath.includes("?") ? "&" : "?"}select=id`,
  );
  if (rows.length > 0) {
    const inserted = await supabaseRest<Row[]>("POST", `/${table}`, {
      prefer: "return=representation",
      body: rows,
    });
    if (inserted.length !== rows.length) {
      // Rollback partial inserts and bail.
      await deleteRowsByIds(table, inserted.map((r) => r.id).filter(Boolean));
      throw new Error(`${table} replacement inserted ${inserted.length} of ${rows.length}`);
    }
  }
  await deleteRowsByIds(table, existing.map((r) => r.id).filter(Boolean));
  return rows.length;
}

function evidenceRows(
  source: AnnualReportSource,
  findings: SpecialistFinding[],
) {
  return findings
    .filter((f) => !f.insufficientEvidence)
    .map((f) => {
      const pages = [
        ...new Set(
          f.citations.map((c) =>
            c.pageStart === c.pageEnd ? String(c.pageStart) : `${c.pageStart}-${c.pageEnd}`,
          ),
        ),
      ];
      const chunks = [...new Set(f.citations.map((c) => c.chunkIndex))];
      const basisTag =
        f.accountingBasis === "CONSOLIDATED" || f.accountingBasis === "STANDALONE"
          ? `; ${f.accountingBasis} basis`
          : "";
      const supportingSource =
        pages.length === 0
          ? `${source.document.title}; evidence insufficient${basisTag}`
          : `${source.document.title}, page ${pages.join(", ")}, chunk ${chunks.join(", ")}${basisTag}`;

      return {
        company_id: RELIANCE_COMPANY_ID,
        document_id: source.document.id,
        report_section: f.reportSection,
        period: f.period || RELIANCE_REPORTING_PERIOD,
        claim: f.fact,
        evidence_type: f.classification,
        supporting_source: supportingSource,
        source_date:
          source.document.publication_date ??
          source.document.document_date ??
          null,
        data_point:
          f.dataPoints.length > 0
            ? `[${f.accountingBasis}] ${f.dataPoints.join(" | ")}`
            : null,
        ai_interpretation: f.analysis || null,
        confidence_level: f.confidence,
      };
    });
}

function renderCalculationsBlock(f: SpecialistFinding): string {
  if (f.calculations.length === 0) return "";
  const lines = f.calculations.map(
    (c) => `• ${c.metric}: ${c.resultLabel}  (${c.formula}, ${c.period})`,
  );
  return `\nCalculations:\n${lines.join("\n")}`;
}

function renderFindingBullet(f: SpecialistFinding): string {
  const classificationTag = `${f.classification === "FACT" ? "Fact" : f.classification === "INFERENCE" ? "Inference" : "Uncertain"} · ${f.confidence.toLowerCase()} confidence · ${f.accountingBasis === "NOT_APPLICABLE" ? "n/a basis" : f.accountingBasis.toLowerCase()}`;

  const parts = [
    f.fact,
    f.analysis && `Analysis: ${f.analysis}`,
    f.investorImplication && `Investor implication: ${f.investorImplication}`,
    renderCalculationsBlock(f),
    `[${classificationTag} · Source: annual report]`,
  ].filter(Boolean);
  return parts.join("\n");
}

function scrubInternalIds(text: string): string {
  if (!text) return "";
  let out = text;
  out = out.replace(/\s*\[F\d+[^\]]*\]/g, "");
  out = out.replace(/\s*\(sourceFindingIds?:[^\)]*\)/gi, "");
  out = out.replace(/\s*\bid\s*[:=]\s*[a-z_]+:[a-z_]+/gi, "");
  out = out.replace(/\s*\bchunks?\s+\d+(?:\s*,\s*\d+)*\b/gi, "");
  out = out.replace(/\s*sourceFindingIds?\s*/gi, "");
  out = out.replace(/[ \t]{2,}/g, " ").replace(/ \./g, ".").trim();
  return out;
}

function renderSection(
  master: MasterSynthesis,
  findings: SpecialistFinding[],
  sectionKey: string,
): string {
  const masterSection = master.sections.find((s) => s.sectionKey === sectionKey);
  const relevantFindings = findings.filter((f) => f.reportSection === sectionKey && !f.insufficientEvidence);

  const parts: string[] = [];
  if (masterSection?.narrative) {
    parts.push(scrubInternalIds(masterSection.narrative));
  }

  if (masterSection?.tables && masterSection.tables.length > 0) {
    for (const t of masterSection.tables) {
      parts.push(`\n[TABLE]${JSON.stringify(t)}[/TABLE]`);
    }
  }

  if (relevantFindings.length > 0) {
    parts.push("\n--- Detailed findings ---");
    for (const f of relevantFindings) {
      parts.push(`\n${scrubInternalIds(renderFindingBullet(f))}`);
    }
  }

  return parts.join("\n").trim();
}

function buildResearchRows(
  master: MasterSynthesis,
  findings: SpecialistFinding[],
): Array<Record<string, unknown>> {
  const lastUpdated = nowIso();
  const row = (section: string, title: string, content: string) => ({
    company_id: RELIANCE_COMPANY_ID,
    section,
    title,
    content,
    last_updated: lastUpdated,
  });

  const rows: Array<Record<string, unknown>> = [];

  // ── Executive layer ──
  rows.push(row("executive_summary", "Executive Summary", scrubInternalIds(master.executiveSummary)));
  rows.push(row("investment_thesis", "Investment Thesis", scrubInternalIds(master.investmentThesis)));

  // ── Ordered sections ──
  const orderedSections: Array<{ key: string; title: string }> = [
    { key: "business_overview", title: "Business Overview" },
    { key: "industry_context", title: "Industry Context" },
    { key: "competitive_position", title: "Competitive Position" },
    { key: "segment_analysis", title: "Segment Analysis" },
    { key: "what_changed", title: "What Changed This Year" },
    { key: "historical_financials", title: "Historical Financial Analysis" },
    { key: "financial_ratios", title: "Financial Ratios" },
    { key: "cash_flow_analysis", title: "Cash Flow Analysis" },
    { key: "balance_sheet_analysis", title: "Balance Sheet Analysis" },
    { key: "receivables_analysis", title: "Receivables" },
    { key: "inventory_analysis", title: "Inventory" },
    { key: "payables_analysis", title: "Payables" },
    { key: "working_capital_analysis", title: "Working Capital" },
    { key: "debt_liquidity", title: "Debt & Liquidity" },
    { key: "management_analysis", title: "Management Commentary" },
    { key: "strategy_capital_allocation", title: "Strategy & Capital Allocation" },
    { key: "guidance_outlook", title: "Guidance & Outlook" },
    { key: "guidance_vs_execution", title: "Guidance vs Execution" },
    { key: "related_party_transactions", title: "Related-Party Transactions" },
    { key: "shareholding_ownership", title: "Shareholding & Ownership" },
    { key: "governance_analysis", title: "Governance" },
    { key: "subsidiaries_jvs", title: "Subsidiaries & JVs" },
    { key: "auditor_analysis", title: "Auditor Analysis" },
    { key: "accounting_analysis", title: "Accounting Analysis" },
    { key: "material_risks", title: "Material Risks" },
    { key: "catalysts_positives", title: "Catalysts & Positive Developments" },
    { key: "investor_monitoring_points", title: "Investor Monitoring Points" },
  ];

  for (const s of orderedSections) {
    const content = renderSection(master, findings, s.key);
    if (content.trim().length > 0) {
      rows.push(row(s.key, s.title, content));
    }
  }

  rows.push(row("final_investor_takeaway", "Final Investor Takeaway", scrubInternalIds(master.finalTakeaway)));

  return rows;
}

export async function persistMultiAgentRun(
  source: AnnualReportSource,
  outputs: SpecialistOutput[],
  qa: QAReport,
  synthesis: MasterSynthesis,
) {
  const allFindings = outputs.flatMap((o) => o.findings);

  const evidence = evidenceRows(source, allFindings);
  const research = buildResearchRows(synthesis, allFindings);

  // Replace evidence rows for this document
  const evidenceCount = await replaceRows(
    "analysis_evidence",
    `/analysis_evidence?document_id=eq.${encodeURIComponent(source.document.id)}`,
    evidence,
  );

  // Replace research rows for this company
  const researchCount = await replaceRows(
    "research",
    `/research?company_id=eq.${encodeURIComponent(RELIANCE_COMPANY_ID)}`,
    research,
  );

  logger.info(
    {
      documentId: source.document.id,
      evidenceCount,
      researchCount,
      qaPassed: qa.passed,
      qaFailed: qa.failed,
    },
    "Multi-agent research persisted",
  );

  return {
    evidenceRows: evidenceCount,
    researchRows: researchCount,
  };
}
