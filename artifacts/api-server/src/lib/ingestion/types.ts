/**
 * Ingestion Pipeline — shared types.
 *
 * Covers every stage of the filing ingestion lifecycle:
 *   Discovery → Retrieval → Extraction → Validation → Storage
 *
 * These types complement data-sources.ts (which owns the stored
 * data model).  This file owns the in-flight pipeline types only.
 */

import type { AccountingBasis, SourceTier, DataQualityStatus } from "../data-sources.js";

// ─────────────────────────────────────────────────────────────
// FILING TYPES
// ─────────────────────────────────────────────────────────────

export type FilingType =
  | "annual_report"
  | "quarterly_result"
  | "half_yearly_result"
  | "nine_month_result"
  | "shareholding_pattern"
  | "investor_presentation"
  | "concall_transcript"
  | "corporate_announcement"
  | "board_meeting"
  | "corporate_action"
  | "insider_trading"
  | "related_party_transactions"
  | "corporate_governance"
  | "brsr"
  | "xbrl_financial"
  | "other_filing";

export type SourceExchange = "NSE" | "BSE" | "COMPANY" | "SEBI" | "MCA";

export type DiscoveryMethod = "nse_rss" | "bse_api" | "nse_api" | "manual" | "xbrl_feed";

export type RetrievalStatus = "pending" | "retrieving" | "complete" | "failed" | "blocked";

export type ProcessingStatus =
  | "unprocessed"
  | "queued"
  | "processing"
  | "processed"
  | "failed";

// ─────────────────────────────────────────────────────────────
// INGESTION ERROR REASONS
// Used in RetrievalResult and throughout the pipeline to
// explain exactly why a stage failed.
// ─────────────────────────────────────────────────────────────

export type IngestionErrorReason =
  /** Cloud/datacenter IP blocked by exchange WAF or Cloudflare */
  | "NETWORK_BLOCKED"
  /** HTTP 403 — authentication or authorisation required */
  | "AUTH_REQUIRED"
  /** HTTP 404 — URL or endpoint does not exist */
  | "NOT_FOUND"
  /** HTTP 429 — rate limited by the source */
  | "RATE_LIMITED"
  /** Reached the source but could not parse the response */
  | "PARSING_FAILED"
  /** Accounting basis (standalone/consolidated) not determinable from source */
  | "BASIS_UNCLEAR"
  /** Network timeout or DNS failure */
  | "SOURCE_UNREACHABLE"
  /** Endpoint has moved or been retired */
  | "ENDPOINT_CHANGED"
  /** PDF is scanned image — text extraction not possible without OCR */
  | "SCANNED_PDF"
  /** XBRL document found but schema version not supported */
  | "XBRL_UNSUPPORTED"
  /** General / unexpected error */
  | "UNKNOWN";

// ─────────────────────────────────────────────────────────────
// DISCOVERED FILING
// Produced by the discovery stage; one entry per filing found.
// ─────────────────────────────────────────────────────────────

export interface DiscoveredFiling {
  companyId: string;
  ticker: string;
  filingType: FilingType;
  filingPeriod?: string | null;
  fiscalYear?: number | null;
  quarter?: number | null;
  filingDate?: string | null;
  sourceExchange: SourceExchange;
  sourceTier: SourceTier;
  discoveryMethod: DiscoveryMethod;
  filingTitle?: string | null;
  filingDescription?: string | null;
  exchangeFilingId?: string | null;
  /** URL of the filing index page (e.g., BSE filing detail) */
  filingUrl?: string | null;
  /** Direct URL to the document (PDF, HTML, XBRL) */
  documentUrl?: string | null;
  xbrlUrl?: string | null;
  xbrlAvailable: boolean;
}

// ─────────────────────────────────────────────────────────────
// DISCOVERY RESULT
// Returned by each discovery source (NSE RSS, BSE API, etc.)
// ─────────────────────────────────────────────────────────────

export type DiscoveryResult =
  | {
      success: true;
      source: string;
      filings: DiscoveredFiling[];
    }
  | {
      success: false;
      source: string;
      reason: IngestionErrorReason;
      httpStatus?: number | null;
      detail: string;
    };

// ─────────────────────────────────────────────────────────────
// RETRIEVAL RESULT
// Returned by the document retrieval stage.
// ─────────────────────────────────────────────────────────────

export type RetrievalResult =
  | {
      success: true;
      url: string;
      contentType: string;
      /** Raw content — HTML string, XML string, or base64-encoded PDF */
      content: string;
      contentLength: number;
      retrievedAt: string;
    }
  | {
      success: false;
      url: string;
      reason: IngestionErrorReason;
      httpStatus?: number | null;
      detail: string;
    };

// ─────────────────────────────────────────────────────────────
// EXTRACTED METRIC
// A single financial value extracted from a document.
// Accounting basis MUST be explicitly present in the source —
// it must never be inferred or defaulted.
// ─────────────────────────────────────────────────────────────

export interface ExtractedMetric {
  metricName: string;
  metricValue: number;
  metricUnit: string;
  currency: string;
  reportingPeriod: string;
  statementType: "income_statement" | "balance_sheet" | "cash_flow" | "notes";
  /**
   * Accounting basis.  If the source document does not explicitly
   * state whether figures are standalone or consolidated, this must
   * be null and dataQualityStatus must be NEEDS_REVIEW.
   * Never infer or default this field.
   */
  accountingBasis: AccountingBasis | null;
  entityName: string;
  extractedFrom: string;
  extractionNotes?: string | null;
}

// ─────────────────────────────────────────────────────────────
// EXTRACTION RESULT
// Returned by the extraction stage (XBRL parser / HTML/PDF extractor).
// ─────────────────────────────────────────────────────────────

export type ExtractionResult =
  | {
      success: true;
      documentType: string;
      extractedMetrics: ExtractedMetric[];
      managementStatements: Array<{
        statement: string;
        speaker?: string;
        topic: string;
        isVerbatim: boolean;
      }>;
      rawText?: string | null;
      extractionNotes?: string | null;
    }
  | {
      success: false;
      reason: IngestionErrorReason;
      detail: string;
    };

// ─────────────────────────────────────────────────────────────
// FILING QUEUE ENTRY
// Maps to a row in public.filing_queue.
// ─────────────────────────────────────────────────────────────

export interface FilingQueueEntry {
  id?: string;
  companyId: string;
  filingType: FilingType;
  filingPeriod?: string | null;
  fiscalYear?: number | null;
  quarter?: number | null;
  filingDate?: string | null;
  sourceExchange: SourceExchange;
  sourceTier: SourceTier;
  discoveryMethod: DiscoveryMethod;
  discoveredAt?: string;
  filingUrl?: string | null;
  documentUrl?: string | null;
  xbrlUrl?: string | null;
  xbrlAvailable: boolean;
  filingTitle?: string | null;
  filingDescription?: string | null;
  exchangeFilingId?: string | null;
  retrievalStatus: RetrievalStatus;
  retrievalError?: string | null;
  retrievalErrorCode?: string | null;
  retrievalAttempts: number;
  lastRetrievalAt?: string | null;
  processingStatus: ProcessingStatus;
  processingError?: string | null;
  processedAt?: string | null;
  documentId?: string | null;
  metricsStored: number;
  dataQualityStatus: DataQualityStatus;
  createdAt?: string;
  updatedAt?: string;
}

// ─────────────────────────────────────────────────────────────
// PIPELINE RUN RESULT
// Full result of one pipeline execution for one company.
// Returned by runIngestionPipeline().
// ─────────────────────────────────────────────────────────────

export interface PipelineRunResult {
  companyId: string;
  ticker: string;
  ranAt: string;
  discovery: {
    sourcesAttempted: string[];
    sourcesSucceeded: string[];
    sourcesFailed: Array<{ source: string; reason: IngestionErrorReason; detail: string }>;
    filingsDiscovered: number;
  };
  retrieval: {
    attempted: number;
    succeeded: number;
    failed: number;
    blocked: number;
    results: Array<{
      filingType: FilingType;
      url: string | null;
      status: RetrievalStatus;
      reason?: IngestionErrorReason;
      detail?: string;
    }>;
  };
  extraction: {
    attempted: number;
    succeeded: number;
    failed: number;
    metricsExtracted: number;
  };
  storage: {
    documentsStored: number;
    metricsStored: number;
    managementStatementsStored: number;
    conflictsDetected: number;
  };
  limitations: string[];
}

// ─────────────────────────────────────────────────────────────
// NSE FILING TYPES (from NSE corporate action categories)
// ─────────────────────────────────────────────────────────────

export const NSE_FILING_TYPE_MAP: Record<string, FilingType> = {
  "Financial Results": "quarterly_result",
  "Annual Report": "annual_report",
  "Shareholding Pattern": "shareholding_pattern",
  "Investor Presentation": "investor_presentation",
  "Corporate Action": "corporate_action",
  "Board Meeting": "board_meeting",
  "Insider Trading": "insider_trading",
  "Related Party Transactions": "related_party_transactions",
};

// ─────────────────────────────────────────────────────────────
// BSE FILING TYPES (from BSE category strings)
// ─────────────────────────────────────────────────────────────

export const BSE_FILING_TYPE_MAP: Record<string, FilingType> = {
  "Financial Results": "quarterly_result",
  "Annual Report": "annual_report",
  "Shareholding Pattern": "shareholding_pattern",
  "Investor Presentation": "investor_presentation",
  "Corporate Action": "corporate_action",
  "Board Meeting": "board_meeting",
  "Insider Trading / Pledge": "insider_trading",
  "Related Party Transactions": "related_party_transactions",
  "Corporate Governance": "corporate_governance",
  "BRSR": "brsr",
};

// ─────────────────────────────────────────────────────────────
// KNOWN FILING PERIODS
// Used to classify quarterly/annual results by period label.
// ─────────────────────────────────────────────────────────────

export const QUARTER_PERIOD_LABELS: Record<string, { quarter: number; filingType: FilingType }> = {
  "Q1": { quarter: 1, filingType: "quarterly_result" },
  "Q2": { quarter: 2, filingType: "quarterly_result" },
  "Q3": { quarter: 3, filingType: "quarterly_result" },
  "Q4": { quarter: 4, filingType: "quarterly_result" },
  "H1": { quarter: 2, filingType: "half_yearly_result" },
  "9M": { quarter: 3, filingType: "nine_month_result" },
  "FY": { quarter: 4, filingType: "annual_report" },
};
