/**
 * Data Source Architecture — types, constants, and validation functions.
 *
 * This module defines the full data ingestion foundation for the
 * StockLens equity research engine.  It covers:
 *
 *   - Company master data (enhanced)
 *   - Financial metrics with full lineage (one row per metric per period)
 *   - Source registry and tier hierarchy
 *   - Document and news metadata
 *   - Management commentary (separate from AI interpretation)
 *   - Shareholding structure
 *   - Data quality and conflict tracking
 *   - Accounting basis integrity validation
 *   - Data lineage chain (conclusion → evidence → data → source)
 *
 * CRITICAL RULES (enforced at type level where possible):
 *   1. Every financial figure MUST carry an accounting_basis.
 *   2. Standalone and consolidated figures MUST NOT be mixed in
 *      a single calculation.
 *   3. Ratios across incompatible periods or entities return
 *      NON_COMPARABLE, never a manufactured number.
 *   4. When two sources conflict, BOTH values are stored and the
 *      record is flagged CONFLICTING — one is never silently chosen.
 *   5. Every AI conclusion must be traceable back to its source
 *      via the DataLineage chain.
 */

// ─────────────────────────────────────────────────────────────
// FUNDAMENTAL TYPES
// ─────────────────────────────────────────────────────────────

/**
 * Accounting basis.
 * The most critical integrity constraint in the data model.
 * Every financial figure must carry exactly one of these values.
 * Mixing STANDALONE and CONSOLIDATED in a single calculation
 * is prohibited and will produce a NON_COMPARABLE result.
 */
export type AccountingBasis = "STANDALONE" | "CONSOLIDATED";

/**
 * Source tier — the trust hierarchy for data sources.
 * Lower numbers = higher trust.  When sources conflict, the
 * value from the lower-tier source is preferred, but BOTH
 * values must be stored and the conflict flagged.
 *
 * Tier 1: Primary filings — annual reports, exchange filings,
 *         auditor reports, regulatory filings (NSE/BSE/SEBI/MCA)
 * Tier 2: Company communications — investor presentations,
 *         official announcements, concall transcripts, MD&A
 * Tier 3: Reliable secondary — financial data providers,
 *         reputable financial news
 * Tier 4: Other secondary sources
 */
export type SourceTier = 1 | 2 | 3 | 4;

export const SOURCE_TIER_DESCRIPTIONS: Record<SourceTier, string> = {
  1: "Tier 1: Primary Filing (annual report, exchange filing, auditor report, regulatory filing)",
  2: "Tier 2: Company Communication (investor presentation, concall transcript, announcement)",
  3: "Tier 3: Reliable Secondary (financial data provider, reputable financial news)",
  4: "Tier 4: Other Secondary Source",
};

/**
 * Data quality status for every imported data point.
 * VERIFIED    — confirmed from a Tier 1 source with no conflicting data
 * UNVERIFIED  — from a lower-tier source or not yet cross-checked
 * CONFLICTING — two or more sources disagree; see data_quality table
 * MISSING     — expected data point not found in any available source
 */
export type DataQualityStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "CONFLICTING"
  | "MISSING";

/**
 * Financial statement the metric belongs to.
 */
export type StatementType =
  | "income_statement"
  | "balance_sheet"
  | "cash_flow"
  | "notes";

/**
 * Reporting period granularity.
 */
export type PeriodType = "annual" | "quarterly" | "half_yearly" | "ltm";

/**
 * Legal/ownership classification of a company record.
 */
export type CompanyType =
  | "listed_company"
  | "holding_company"
  | "subsidiary"
  | "associate"
  | "jv";

// ─────────────────────────────────────────────────────────────
// VALID FINANCIAL METRIC NAMES
// The canonical list of metric names recognised by the system.
// Every row in financial_metrics must use one of these names.
// ─────────────────────────────────────────────────────────────

export const FINANCIAL_METRIC_NAMES = [
  // Income statement
  "revenue",
  "ebitda",
  "ebit",
  "pat",
  "eps",
  "other_income",
  "finance_cost",
  "depreciation",
  "exceptional_items",
  "minority_interest",
  // Balance sheet
  "total_assets",
  "net_worth",
  "cash",
  "total_debt",
  "net_debt",
  "receivables",
  "inventory",
  "payables",
  "working_capital",
  // Cash flow statement
  "operating_cash_flow",
  "investing_cash_flow",
  "financing_cash_flow",
  "capex",
  "free_cash_flow",
] as const;

export type FinancialMetricName = (typeof FINANCIAL_METRIC_NAMES)[number];

// ─────────────────────────────────────────────────────────────
// SOURCE RECORD
// Maps to a row in public.source_registry.
// ─────────────────────────────────────────────────────────────

export interface SourceRecord {
  id?: string;
  sourceName: string;
  sourceType: string;
  tier: SourceTier;
  tierLabel: string;
  baseUrl?: string | null;
  description?: string | null;
  isActive: boolean;
  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// ENHANCED COMPANY MASTER DATA
// Extends the base company row with the new columns from
// migration_003. Sub-industry remains in CompanyProfile (migration_001).
// ─────────────────────────────────────────────────────────────

export interface CompanyMaster {
  id?: string;
  name: string;
  legalName?: string | null;
  ticker: string;
  exchange: string;
  isin?: string | null;
  sector: string;
  industry: string;
  /**
   * Legal/ownership type of this record.
   * Sub-industry and industry-framework type are stored in company_profiles.
   */
  companyType: CompanyType;
  parentCompanyId?: string | null;
  reportingCurrency: string;
  fiscalYearEnd: string;
  isActive: boolean;
  shortDescription: string;
  createdAt?: string;
  updatedAt?: string;
}

// ─────────────────────────────────────────────────────────────
// FINANCIAL METRIC WITH FULL LINEAGE
// Maps to a row in public.financial_metrics.
//
// CRITICAL: accountingBasis is required and has no default.
// A FinancialMetric without an accountingBasis cannot be
// inserted or used in a validation function.
// ─────────────────────────────────────────────────────────────

export interface FinancialMetric {
  id?: string;
  companyId: string;

  // Entity — may differ from the listed company (e.g., a subsidiary)
  entityName: string;
  entityTicker?: string | null;

  // Metric
  metricName: FinancialMetricName;
  metricValue: number;
  metricUnit: string;
  currency: string;

  // Period
  reportingPeriod: string;       // e.g. "FY24", "Q3FY25"
  fiscalYear?: number | null;    // e.g. 2024
  periodType: PeriodType;
  quarter?: number | null;       // 1-4 for quarterly data

  // Statement
  statementType: StatementType;

  /**
   * Accounting basis. REQUIRED. No default.
   * Must be established at ingestion time from the source document.
   */
  accountingBasis: AccountingBasis;

  // Full source provenance
  sourceName: string;
  sourceTier: SourceTier;
  sourceRegistryId?: string | null;
  sourceDocumentId?: string | null;
  sourceUrl?: string | null;
  sourceDate?: string | null;
  extractionDate?: string;

  // Data quality
  dataQualityStatus: DataQualityStatus;
  isDemo: boolean;
  qualityNotes?: string | null;

  createdAt?: string;
  updatedAt?: string;
}

// ─────────────────────────────────────────────────────────────
// ENHANCED DOCUMENT METADATA
// Maps to a row in public.documents with the new columns.
// ─────────────────────────────────────────────────────────────

export type DocumentType =
  | "annual_report"
  | "quarterly_result"
  | "investor_presentation"
  | "concall_transcript"
  | "mda"
  | "auditor_report"
  | "notes_to_accounts"
  | "shareholding_pattern"
  | "corporate_announcement"
  | "exchange_filing"
  | "credit_rating_report"
  | "other_filing"
  | "demo_note";

export type TextExtractionStatus = "pending" | "extracting" | "complete" | "failed";
export type DocumentProcessingStatus =
  | "unprocessed"
  | "queued"
  | "processing"
  | "processed"
  | "failed";

export interface DocumentMetadata {
  id?: string;
  companyId: string;
  title: string;
  documentType: DocumentType;
  reportingPeriod?: string | null;
  documentDate?: string | null;
  publicationDate?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  /** URL or path where the actual document file is stored */
  documentUrl?: string | null;
  /** Internal file reference (e.g., object storage key) */
  fileReference?: string | null;
  sourceTier?: SourceTier | null;
  sourceRegistryId?: string | null;
  content?: string | null;
  textExtractionStatus: TextExtractionStatus;
  processingStatus: DocumentProcessingStatus;
  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// ENHANCED NEWS RECORD
// Maps to a row in public.news with the new columns.
// ─────────────────────────────────────────────────────────────

export type NewsMateriality = "low" | "medium" | "high";

export interface NewsRecord {
  id?: string;
  companyId: string;
  headline: string;
  summary?: string | null;
  publishedAt?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  category: string;
  /**
   * Relevance to the company's investment thesis (0–1).
   * Populated during processing, not at ingestion.
   */
  relevanceScore?: number | null;
  /**
   * Materiality assessment: whether this news is likely to
   * affect the company's financial results or business materially.
   */
  materiality?: NewsMateriality | null;
  isProcessed: boolean;
  sourceTier?: SourceTier | null;
  sourceRegistryId?: string | null;
  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// MANAGEMENT COMMENTARY
// Stores management statements separately from AI interpretation.
// Critical for: MANAGEMENT SAID vs WHAT ACTUALLY HAPPENED.
// The AI must never interpret statements stored here.
// Interpretation happens separately and is stored in analysis_evidence.
// ─────────────────────────────────────────────────────────────

export type ManagementTopic =
  | "guidance"
  | "explanation"
  | "strategy"
  | "outlook"
  | "risk"
  | "results"
  | "other";

export type GuidanceType =
  | "revenue_guidance"
  | "margin_guidance"
  | "volume_guidance"
  | "capex_guidance"
  | "dividend_guidance"
  | "npa_guidance"
  | "credit_growth_guidance"
  | "general"
  | "other";

export interface ManagementCommentary {
  id?: string;
  companyId: string;

  /** The exact statement or a faithful paraphrase. */
  statement: string;
  /** Name and designation of the speaker. */
  speaker?: string | null;

  // Source
  sourceDocumentId?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
  sourceTier?: SourceTier | null;
  statementDate?: string | null;

  // Context
  reportingPeriod?: string | null;
  topic: ManagementTopic;
  guidanceType?: GuidanceType | null;
  /**
   * True if this is a direct verbatim quote from a transcript or filing.
   * False if it is a paraphrase.
   */
  isVerbatim: boolean;

  // Outcome tracking (populated later when actuals are available)
  isProcessed: boolean;
  actualOutcome?: string | null;
  outcomePeriod?: string | null;
  outcomeAssessedAt?: string | null;

  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// SHAREHOLDING
// Maps to a row in public.shareholding.
// All percentage fields are 0–100 (not 0–1).
// ─────────────────────────────────────────────────────────────

export interface MajorShareholder {
  name: string;
  /** Category: promoter, fii, dii, mutual_fund, individual, other */
  category: string;
  holdingPct: number;
  changeFromPriorPct?: number | null;
}

export interface ShareholdingChange {
  promoterChange?: number | null;
  fiiChange?: number | null;
  diiChange?: number | null;
  publicChange?: number | null;
}

export interface ShareholdingRecord {
  id?: string;
  companyId: string;

  reportingPeriod: string;
  reportDate: string;

  totalShares?: number | null;
  sharesUnit: string;

  // Percentages (0–100)
  promoterHoldingPct?: number | null;
  promoterPledgedPct?: number | null;
  fiiFpiHoldingPct?: number | null;
  diiHoldingPct?: number | null;
  mutualFundsHoldingPct?: number | null;
  publicHoldingPct?: number | null;

  majorShareholders: MajorShareholder[];
  changeFromPrior: ShareholdingChange;

  sourceName: string;
  sourceUrl?: string | null;
  sourceTier?: SourceTier | null;
  sourceRegistryId?: string | null;
  dataQualityStatus: DataQualityStatus;

  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// DATA QUALITY — CONFLICT RECORD
// Maps to a row in public.data_quality.
// Created whenever two sources disagree on the same data point.
// Resolution is always explicit — never automatic.
// ─────────────────────────────────────────────────────────────

export type ConflictResolutionStatus = "pending" | "resolved" | "ignored";

export interface DataQualityRecord {
  id?: string;
  companyId: string;

  sourceTable: string;
  sourceRecordId: string;
  fieldName: string;

  metricName?: string | null;
  reportingPeriod?: string | null;
  accountingBasis?: AccountingBasis | null;

  // The two conflicting values
  valueA: string;
  sourceAName: string;
  sourceATier: SourceTier;
  sourceAUrl?: string | null;
  sourceADate?: string | null;

  valueB: string;
  sourceBName: string;
  sourceBTier: SourceTier;
  sourceBUrl?: string | null;
  sourceBDate?: string | null;

  resolutionStatus: ConflictResolutionStatus;
  resolvedValue?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;

  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────
// DATA LINEAGE
// Every AI-generated conclusion must be traceable back to its
// original source through this chain:
//
//   Conclusion
//   → Evidence (analysis_evidence table)
//   → Financial data / Document (financial_metrics / documents table)
//   → Original source (source_registry)
// ─────────────────────────────────────────────────────────────

export interface DataLineage {
  /** The conclusion or claim being made. */
  conclusion: string;
  /** ID(s) of the analysis_evidence rows that support this conclusion. */
  evidenceIds: string[];
  /** IDs of the financial_metric or document rows the evidence draws from. */
  dataRecordIds: string[];
  /** The source_registry entries for those records. */
  sources: Array<{
    sourceName: string;
    sourceTier: SourceTier;
    sourceUrl?: string | null;
    sourceDate?: string | null;
    accountingBasis?: AccountingBasis | null;
    reportingPeriod?: string | null;
  }>;
}

// ─────────────────────────────────────────────────────────────
// ACCOUNTING BASIS INTEGRITY — VALIDATION TYPES
// ─────────────────────────────────────────────────────────────

/**
 * Result of any compatibility check.
 * When compatible is false, the verdict MUST be used to mark
 * the calculation or comparison — never produce a number.
 */
export type CompatibilityResult =
  | { compatible: true }
  | {
      compatible: false;
      /**
       * NON_COMPARABLE — the data exists but cannot be compared
       *   because the basis, period, entity, or currency differ.
       * INSUFFICIENT_DATA — not enough data to complete the check.
       */
      verdict: "NON_COMPARABLE" | "INSUFFICIENT_DATA";
      reason: string;
    };

/** Full validation report for a pair of metrics used in a calculation. */
export interface MetricPairValidationReport {
  metricAName: string;
  metricBName: string;
  basisCheck: CompatibilityResult;
  periodCheck: CompatibilityResult;
  currencyCheck: CompatibilityResult;
  entityCheck: CompatibilityResult;
  /** Overall: compatible only if ALL individual checks pass. */
  overallCompatible: boolean;
  /**
   * If not compatible, the single most important reason to surface.
   * Basis incompatibility takes priority over period incompatibility.
   */
  primaryBlocker?: string;
}

/** Validation report for a peer comparison set. */
export interface PeerComparisonValidationReport {
  metrics: Array<{ companyId: string; metricName: string; reportingPeriod: string; accountingBasis: AccountingBasis; currency: string }>;
  basisConsistent: boolean;
  periodsConsistent: boolean;
  currenciesConsistent: boolean;
  overallComparable: boolean;
  issues: string[];
}

// ─────────────────────────────────────────────────────────────
// ACCOUNTING BASIS INTEGRITY — VALIDATION FUNCTIONS
// ─────────────────────────────────────────────────────────────

/**
 * Checks whether two accounting bases are compatible for use
 * in the same calculation or ratio.
 * STANDALONE and CONSOLIDATED are never compatible.
 */
export function validateAccountingBasis(
  basisA: AccountingBasis,
  basisB: AccountingBasis,
): CompatibilityResult {
  if (basisA === basisB) return { compatible: true };
  return {
    compatible: false,
    verdict: "NON_COMPARABLE",
    reason: `Accounting basis mismatch: cannot combine ${basisA} and ${basisB} figures in a single calculation. Select one basis and use it consistently.`,
  };
}

/**
 * Checks whether two reporting periods are compatible.
 * Periods must be identical for a direct comparison.
 * If comparing across periods (e.g., FY24 vs FY23 for growth),
 * the caller must explicitly document this as a time-series
 * comparison, not a same-period comparison.
 */
export function validatePeriodCompatibility(
  periodA: string,
  periodB: string,
  allowTimeSeries = false,
): CompatibilityResult {
  if (periodA === periodB) return { compatible: true };
  if (allowTimeSeries) return { compatible: true };
  return {
    compatible: false,
    verdict: "NON_COMPARABLE",
    reason: `Period mismatch: "${periodA}" vs "${periodB}". Use allowTimeSeries=true only if the intent is a time-series comparison (e.g., growth rate), not a same-period ratio.`,
  };
}

/**
 * Checks whether two currencies are compatible.
 * Currency conversion requires an explicit exchange rate and date —
 * it is never performed silently.
 */
export function validateCurrencyCompatibility(
  currencyA: string,
  currencyB: string,
): CompatibilityResult {
  if (currencyA === currencyB) return { compatible: true };
  return {
    compatible: false,
    verdict: "NON_COMPARABLE",
    reason: `Currency mismatch: "${currencyA}" vs "${currencyB}". Currency conversion requires an explicit exchange rate and date. Do not convert silently.`,
  };
}

/**
 * Checks whether two entity names refer to the same reporting entity.
 * Used to prevent mixing subsidiary figures with parent figures.
 */
export function validateEntityCompatibility(
  entityA: string,
  entityB: string,
): CompatibilityResult {
  if (entityA.trim().toLowerCase() === entityB.trim().toLowerCase()) {
    return { compatible: true };
  }
  return {
    compatible: false,
    verdict: "NON_COMPARABLE",
    reason: `Entity mismatch: "${entityA}" vs "${entityB}". Figures from different entities cannot be combined without explicit consolidation logic.`,
  };
}

/**
 * Full compatibility validation for two FinancialMetric instances
 * that will be used together in a calculation or ratio.
 *
 * Returns a MetricPairValidationReport. Only proceed with the
 * calculation if overallCompatible is true.
 *
 * Priority order for blockers:
 *   1. Basis (most critical)
 *   2. Entity
 *   3. Currency
 *   4. Period
 */
export function validateMetricPair(
  a: FinancialMetric,
  b: FinancialMetric,
  options: { allowTimeSeries?: boolean } = {},
): MetricPairValidationReport {
  const basisCheck = validateAccountingBasis(a.accountingBasis, b.accountingBasis);
  const entityCheck = validateEntityCompatibility(a.entityName, b.entityName);
  const currencyCheck = validateCurrencyCompatibility(a.currency, b.currency);
  const periodCheck = validatePeriodCompatibility(
    a.reportingPeriod,
    b.reportingPeriod,
    options.allowTimeSeries,
  );

  const overallCompatible =
    basisCheck.compatible &&
    entityCheck.compatible &&
    currencyCheck.compatible &&
    periodCheck.compatible;

  let primaryBlocker: string | undefined;
  if (!basisCheck.compatible) primaryBlocker = basisCheck.reason;
  else if (!entityCheck.compatible) primaryBlocker = entityCheck.reason;
  else if (!currencyCheck.compatible) primaryBlocker = currencyCheck.reason;
  else if (!periodCheck.compatible) primaryBlocker = periodCheck.reason;

  return {
    metricAName: a.metricName,
    metricBName: b.metricName,
    basisCheck,
    periodCheck,
    currencyCheck,
    entityCheck,
    overallCompatible,
    primaryBlocker,
  };
}

/**
 * Validates whether a set of metrics from multiple companies
 * can be used in a peer comparison.
 *
 * All metrics in a peer set must share:
 *   - the same accounting basis
 *   - the same reporting period (or LTM with equivalent end date)
 *   - the same currency
 *
 * Returns a PeerComparisonValidationReport. Only proceed if
 * overallComparable is true.
 */
export function validatePeerComparison(
  metrics: Array<{
    companyId: string;
    metricName: string;
    reportingPeriod: string;
    accountingBasis: AccountingBasis;
    currency: string;
  }>,
): PeerComparisonValidationReport {
  const issues: string[] = [];

  const bases = new Set(metrics.map((m) => m.accountingBasis));
  const periods = new Set(metrics.map((m) => m.reportingPeriod));
  const currencies = new Set(metrics.map((m) => m.currency));

  const basisConsistent = bases.size <= 1;
  const periodsConsistent = periods.size <= 1;
  const currenciesConsistent = currencies.size <= 1;

  if (!basisConsistent) {
    issues.push(
      `Accounting basis is not consistent across peers: ${[...bases].join(", ")}. All peers must use the same basis.`,
    );
  }
  if (!periodsConsistent) {
    issues.push(
      `Reporting periods are not consistent across peers: ${[...periods].join(", ")}. Normalise to the same period before comparing.`,
    );
  }
  if (!currenciesConsistent) {
    issues.push(
      `Currencies are not consistent across peers: ${[...currencies].join(", ")}. Currency conversion requires an explicit exchange rate.`,
    );
  }

  return {
    metrics,
    basisConsistent,
    periodsConsistent,
    currenciesConsistent,
    overallComparable: basisConsistent && periodsConsistent && currenciesConsistent,
    issues,
  };
}

// ─────────────────────────────────────────────────────────────
// SOURCE SELECTION
// When multiple sources provide the same data point, the
// source with the lowest tier number (highest trust) is
// preferred for the VERIFIED value.  All other values must
// be stored and any disagreement flagged as CONFLICTING.
// ─────────────────────────────────────────────────────────────

/**
 * Given a list of source records, returns the one with the
 * lowest tier number (highest trust).  If multiple sources
 * share the lowest tier, returns the first one in the input.
 * Returns null if the list is empty.
 */
export function selectPreferredSource(sources: SourceRecord[]): SourceRecord | null {
  if (sources.length === 0) return null;
  return sources.reduce((best, current) =>
    current.tier < best.tier ? current : best,
  );
}

// ─────────────────────────────────────────────────────────────
// CONFLICT DETECTION
// Called at ingestion time when a metric value already exists
// for the same (company, metric, period, basis, entity) tuple.
// ─────────────────────────────────────────────────────────────

export type ConflictDetectionResult =
  | { conflict: false }
  | {
      conflict: true;
      existingValue: number;
      existingSourceTier: SourceTier;
      existingSourceName: string;
      incomingValue: number;
      incomingSourceTier: SourceTier;
      incomingSourceName: string;
      /**
       * Which value the system would prefer based on tier.
       * Must still be stored alongside the other for auditing.
       */
      preferredValue: number;
      preferredSourceName: string;
    };

/**
 * Compares an existing FinancialMetric with an incoming one
 * for the same data point.  Returns a conflict result if the
 * values differ materially (more than 0.01% relative difference).
 *
 * The caller must:
 *   1. Create a DataQualityRecord storing both values.
 *   2. Mark the existing record as CONFLICTING.
 *   3. NOT silently update the value.
 */
export function detectConflict(
  existing: FinancialMetric,
  incoming: FinancialMetric,
): ConflictDetectionResult {
  const threshold = 0.0001; // 0.01% — below this, treat as rounding difference
  const existingVal = existing.metricValue;
  const incomingVal = incoming.metricValue;
  const base = Math.max(Math.abs(existingVal), Math.abs(incomingVal), 1);
  const relativeDiff = Math.abs(existingVal - incomingVal) / base;

  if (relativeDiff <= threshold) return { conflict: false };

  const preferExisting = existing.sourceTier <= incoming.sourceTier;

  return {
    conflict: true,
    existingValue: existingVal,
    existingSourceTier: existing.sourceTier,
    existingSourceName: existing.sourceName,
    incomingValue: incomingVal,
    incomingSourceTier: incoming.sourceTier,
    incomingSourceName: incoming.sourceName,
    preferredValue: preferExisting ? existingVal : incomingVal,
    preferredSourceName: preferExisting
      ? existing.sourceName
      : incoming.sourceName,
  };
}

// ─────────────────────────────────────────────────────────────
// METRIC LOOKUP KEY
// Canonical key for identifying a unique data point.
// Used to detect duplicates and conflicts during ingestion.
// ─────────────────────────────────────────────────────────────

export interface MetricLookupKey {
  companyId: string;
  entityName: string;
  metricName: FinancialMetricName;
  reportingPeriod: string;
  accountingBasis: AccountingBasis;
}

export function metricLookupKey(m: MetricLookupKey): string {
  return [
    m.companyId,
    m.entityName.trim().toLowerCase(),
    m.metricName,
    m.reportingPeriod,
    m.accountingBasis,
  ].join("::");
}
