/**
 * Multi-Source Intelligence Layer — Types.
 *
 * A "source" is any external piece of information about a company that
 * StockLens can automatically discover and (where legal / permitted)
 * fetch. Sources feed the existing 7-specialist research engine.
 *
 * These types are internal — never expose IDs/URLs to specialists in
 * prompts. Only content + metadata.
 */

export type SourceType =
  | "annual_report"          // PDFs (already ingested via existing pipeline)
  | "concall"                // Earnings-call transcript PDF
  | "credit_rating"          // Rating agency press release / rationale PDF
  | "filing"                 // Corporate announcement / regulatory filing
  | "investor_presentation"  // Quarterly IR deck PDF
  | "news";                  // News item (short-form, headline + summary)

/** Which existing report sections a source type could materially affect. */
export const SOURCE_TO_REPORT_SECTIONS: Record<SourceType, string[]> = {
  annual_report: [
    "business_overview", "segment_analysis", "historical_financials",
    "financial_ratios", "cash_flow_analysis", "balance_sheet_analysis",
    "receivables_analysis", "inventory_analysis", "payables_analysis",
    "working_capital_analysis", "debt_liquidity",
    "related_party_transactions", "governance_analysis",
    "auditor_analysis", "accounting_analysis",
    "material_risks", "catalysts_positives",
  ],
  concall: [
    "management_analysis", "strategy_capital_allocation",
    "guidance_outlook", "guidance_vs_execution",
    "material_risks", "catalysts_positives",
    "investor_monitoring_points",
  ],
  credit_rating: [
    "debt_liquidity", "material_risks", "financial_ratios",
    "cash_flow_analysis",
  ],
  filing: [
    "what_changed", "material_risks", "catalysts_positives",
    "management_analysis", "governance_analysis",
  ],
  investor_presentation: [
    "strategy_capital_allocation", "segment_analysis",
    "guidance_outlook", "management_analysis",
  ],
  news: [
    "what_changed", "material_risks", "catalysts_positives",
    "investor_monitoring_points",
  ],
};

export type IngestionStatus =
  | "QUEUED"
  | "DISCOVERING"
  | "FOUND"
  | "DOWNLOADING"
  | "EXTRACTING"
  | "CHUNKING"
  | "INDEXING"
  | "COMPLETE"
  | "NO_NEW_DATA"
  | "FAILED";

/**
 * A discovered intelligence item. Persisted in one of:
 *   • `news` table  (source_type === 'news')
 *   • `documents` table (all other source types with a PDF/URL)
 *
 * A discovery run produces DiscoveredItem[]; the persister decides
 * where to store each and how to dedupe.
 */
export interface DiscoveredItem {
  companyId: string;
  sourceType: SourceType;
  title: string;
  headline?: string;
  summary?: string;
  publicationDate?: string;   // ISO date
  publisher?: string;
  originalUrl: string;
  documentUrl?: string;       // If a PDF was found
  quarter?: string;           // e.g. "Q1FY26"
  financialYear?: string;     // e.g. "FY2025-26"
  contentHash: string;        // For dedupe (sha256 of source_url + normalized title)
  metadata?: Record<string, unknown>;
}

export interface DiscoveryReport {
  companyId: string;
  ticker: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  bySourceType: Record<SourceType, {
    fetched: number;
    stored: number;
    skippedDuplicate: number;
    error?: string;
  }>;
  totalStored: number;
}
