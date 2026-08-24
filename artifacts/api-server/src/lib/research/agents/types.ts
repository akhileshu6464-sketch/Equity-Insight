/**
 * Multi-Agent Research — Shared types.
 *
 * Every specialist agent returns SpecialistFinding[] with a consistent shape:
 *   fact  → what the annual report literally says (verbatim data point)
 *   evidence → chunk/page references + supporting excerpt
 *   analysis → what changed, why, why it matters (interpretation)
 *   investorImplication → concise investor-facing takeaway
 *
 * The Master Agent takes SpecialistFinding[] from all specialists and produces
 * a MasterSynthesis. The QA Validator then annotates each finding with a
 * QAStatus. The final ReportComposition combines everything into a professional
 * Initiating Coverage report.
 */

import type {
  ConfidenceLevel,
  EvidenceType,
} from "../../evidence.js";
import type {
  AccountingBasis,
  ValidatedCitation,
} from "../annual-report-types.js";

export type SpecialistKey =
  | "business_industry"
  | "financial"
  | "cashflow_balance"
  | "management_strategy"
  | "rpt_governance"
  | "auditor_accounting"
  | "risks_catalysts";

export type ReportSectionKey =
  // Business & Industry
  | "executive_summary"
  | "investment_thesis"
  | "business_overview"
  | "industry_context"
  | "competitive_position"
  | "segment_analysis"
  | "what_changed"
  // Financial
  | "historical_financials"
  | "financial_ratios"
  // Cash & BS
  | "cash_flow_analysis"
  | "balance_sheet_analysis"
  | "receivables_analysis"
  | "inventory_analysis"
  | "payables_analysis"
  | "working_capital_analysis"
  | "debt_liquidity"
  // Management
  | "management_analysis"
  | "strategy_capital_allocation"
  | "guidance_outlook"
  | "guidance_vs_execution"
  // RPT & Governance
  | "related_party_transactions"
  | "shareholding_ownership"
  | "governance_analysis"
  | "subsidiaries_jvs"
  // Auditor & Accounting
  | "auditor_analysis"
  | "accounting_analysis"
  // Risks & Catalysts
  | "material_risks"
  | "catalysts_positives"
  | "investor_monitoring_points"
  | "final_investor_takeaway";

export interface CalculationRecord {
  metric: string;
  inputs: Array<{ label: string; value: number; unit?: string; period: string; basis: AccountingBasis }>;
  formula: string;
  result: number;
  resultLabel: string;   // human formatted: "17.8%", "₹95,754 cr"
  period: string;
}

/**
 * A single research question answered by a specialist agent, with full
 * FACT + EVIDENCE + ANALYSIS + IMPLICATION structure. This is the atomic unit
 * of research produced by every specialist.
 */
export interface SpecialistFinding {
  id: string;
  specialist: SpecialistKey;
  reportSection: ReportSectionKey;
  researchQuestion: string;
  fact: string;
  dataPoints: string[];               // Raw quoted numbers/facts from the source
  calculations: CalculationRecord[];  // Programmatic calculations (never LLM arithmetic)
  analysis: string;                   // What changed, why, why it matters
  investorImplication: string;        // Investor-facing takeaway
  classification: EvidenceType;       // FACT | INFERENCE | UNCERTAIN
  confidence: ConfidenceLevel;
  accountingBasis: AccountingBasis;
  period: string;
  citations: ValidatedCitation[];
  supportingQuote: string;            // Verbatim excerpt that supports the fact
  insufficientEvidence: boolean;
  insufficientReason?: string;
}

export interface SpecialistOutput {
  specialist: SpecialistKey;
  findings: SpecialistFinding[];
  questionsAttempted: string[];
  questionsInsufficient: string[];    // Questions that had no evidence
  durationMs: number;
}

export type QAStatus =
  | "PASS"
  | "NUMERICAL_MISMATCH"
  | "PERIOD_INCONSISTENT"
  | "BASIS_MIXED"
  | "UNSUPPORTED_CONCLUSION"
  | "CONTRADICTS_OTHER_FINDING"
  | "MISSING_EVIDENCE";

export interface QAAnnotation {
  findingId: string;
  status: QAStatus;
  detail: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
}

export interface QAReport {
  totalFindings: number;
  passed: number;
  failed: number;
  annotations: QAAnnotation[];
  contradictions: Array<{
    findingIdA: string;
    findingIdB: string;
    detail: string;
  }>;
  missingChecklistQuestions: string[];
}

/**
 * MasterSynthesis is the Master Research Agent's own writing that ties
 * specialist findings together into a coherent narrative for each report
 * section. The Master Agent does NOT re-run arithmetic; it consumes the
 * specialists' pre-calculated numbers and shapes them into prose + tables.
 */
export interface MasterSynthesisSection {
  sectionKey: ReportSectionKey;
  title: string;
  narrative: string;                   // Master's synthesized prose (multi-paragraph)
  tables: MasterTable[];
  sourceFindingIds: string[];          // Which specialist findings this pulls from
}

export interface MasterTable {
  title: string;
  headers: string[];
  rows: string[][];
  footnote?: string;
}

export interface MasterSynthesis {
  sections: MasterSynthesisSection[];
  executiveSummary: string;
  investmentThesis: string;
  finalTakeaway: string;
}
