/**
 * Evidence System — types for storing and classifying AI conclusions.
 *
 * Every claim the AI makes must be backed by a stored evidence record.
 * The AI must never invent data, never assume a red flag without evidence,
 * and must explicitly label each conclusion as FACT, INFERENCE, or UNCERTAIN.
 *
 * Rules:
 * - FACT        : directly observable from a source document or data point
 * - INFERENCE   : logically derived from one or more facts; clearly labelled as interpretation
 * - UNCERTAIN   : insufficient evidence; the AI must say so rather than guess
 */

// ─────────────────────────────────────────────────────────────
// EVIDENCE CLASSIFICATION
// ─────────────────────────────────────────────────────────────

export type EvidenceType = "FACT" | "INFERENCE" | "UNCERTAIN";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

// ─────────────────────────────────────────────────────────────
// EVIDENCE RECORD
// Maps 1:1 to a row in public.analysis_evidence
// ─────────────────────────────────────────────────────────────

export interface Evidence {
  id?: string;
  companyId: string;
  documentId?: string | null;
  reportSection: string;
  period?: string | null;
  /**
   * The assertion being made.
   * Must be a single, testable claim — not a paragraph.
   * e.g. "Receivables grew 18% while revenue grew 8% in FY24"
   */
  claim: string;
  evidenceType: EvidenceType;
  /**
   * Where this data came from.
   * e.g. "Reliance Industries FY24 Annual Report, page 142"
   * Must be as specific as available data permits.
   */
  supportingSource?: string | null;
  sourceDate?: string | null;           // ISO date string
  /**
   * The specific number, quote, or fact extracted from the source.
   * e.g. "Receivables: ₹1,42,000 cr (FY24) vs ₹1,20,000 cr (FY23)"
   */
  dataPoint?: string | null;
  /**
   * The AI's interpretation of this data point.
   * Must be clearly separated from the fact itself.
   */
  aiInterpretation?: string | null;
  confidenceLevel: ConfidenceLevel;
  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// CROSS-CHECK RESULT
// Maps 1:1 to a row in public.cross_checks
// ─────────────────────────────────────────────────────────────

export type CrossCheckResult = "PASS" | "FLAG" | "WARN" | "INSUFFICIENT_DATA";
export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH";

export interface CrossCheck {
  id?: string;
  companyId: string;
  period?: string | null;
  /**
   * Must match a rule_key from the company's IndustryFramework.crossCheckRules.
   * Do not invent new rule keys.
   */
  ruleKey: string;
  ruleDescription: string;
  metricAName: string;
  metricAValue?: number | null;
  metricBName: string;
  metricBValue?: number | null;
  expectedRelationship: string;
  result: CrossCheckResult;
  /**
   * What the AI actually observed when comparing the two metrics.
   * Must reference real numbers where available.
   * If data is missing, result must be INSUFFICIENT_DATA.
   */
  finding?: string | null;
  severity?: SeverityLevel | null;
  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// RESEARCH JOB
// Maps 1:1 to a row in public.research_jobs
// ─────────────────────────────────────────────────────────────

export type JobStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";

export interface ResearchJob {
  id?: string;
  companyId: string;
  status: JobStatus;
  industryType?: string | null;
  sectionsRequested: string[];
  sectionsCompleted: string[];
  sectionsFailed: string[];
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// AI RULES (enforced at prompt-construction time)
// These are not runtime checks — they are the contract the AI
// must follow. Any function that builds an AI prompt must embed
// these rules.
// ─────────────────────────────────────────────────────────────

export const AI_RULES = {
  // ── Core integrity rules (original) ──────────────────────────
  NEVER_FABRICATE:
    "Never fabricate financial information. If a figure is not in the source data, say it is unavailable.",
  NEVER_INVENT_PRICE_REASONS:
    "Never invent reasons for a stock price movement. Price moves can only be noted if a clear catalyst is documented.",
  NEVER_ASSUME_RED_FLAG:
    "Never assume a red flag exists without evidence. An unusual number requires context before a conclusion.",
  NEVER_TREAT_RPT_AS_SUSPICIOUS:
    "Never treat every related-party transaction as suspicious. Size, pricing, and purpose must be assessed first.",
  NEVER_BLINDLY_TRUST_MANAGEMENT:
    "Never blindly trust management commentary. Compare guidance to actual delivered results.",
  NEVER_TRUST_ONE_STATEMENT:
    "Never rely on one financial statement. Cross-check P&L against cash flow and balance sheet.",
  IDENTIFY_CONTRADICTIONS:
    "Actively identify contradictions between financial statements, management commentary, and market data.",
  DISTINGUISH_FACTS:
    "Clearly distinguish FACT from INFERENCE from UNCERTAIN in every significant conclusion.",
  SAY_INSUFFICIENT:
    "When evidence is insufficient to reach a conclusion, say so explicitly. Do not guess.",
  USE_BUSINESS_CONTEXT:
    "Every analysis must use the company's actual business model and industry. Avoid generic commentary.",

  // ── Context-first behaviour (new) ────────────────────────────
  CONTEXT_BEFORE_CONCLUSION:
    "Understand the company, its business model, industry, strategy and financial structure before applying any research check. Do not force checks onto companies where they are not relevant.",
  MATERIALITY_BEFORE_FLAG:
    "Assess materiality before reporting a concern. A condition must be material in size, persistent in duration, and supported by evidence before it becomes a finding.",
  NO_MECHANICAL_FLAGGING:
    "Do not mechanically flag a condition as a red flag. An auditor change, a contingent liability, high promoter remuneration and exceptional items each require investigation and context — not automatic suspicion.",

  // ── Financial basis integrity (new) ──────────────────────────
  NEVER_MIX_BASIS:
    "Never mix standalone and consolidated financial figures in a single calculation. Tag every figure with its reporting entity and basis.",
  TRACK_PERIOD:
    "Every financial figure must be tagged with the exact reporting period. Do not compare figures from different periods without explicit adjustment.",
  PEER_NORMALISATION:
    "For peer comparisons, normalise the reporting basis and period before comparing. If a clean comparison cannot be made on available data, say so explicitly and do not manufacture one.",
  BASIS_BY_QUESTION:
    "The appropriate reporting basis (standalone vs consolidated) must be determined by the analytical question and company structure, not by a blanket rule.",
} as const;

export type AiRule = (typeof AI_RULES)[keyof typeof AI_RULES];
