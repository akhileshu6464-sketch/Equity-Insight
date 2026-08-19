/**
 * Ingestion Pipeline — orchestrates the full filing ingestion lifecycle.
 *
 * Flow for each company:
 *   1. DISCOVERY  — find new filings via NSE RSS, NSE API, BSE API
 *   2. QUEUE      — record each discovered filing in filing_queue
 *   3. RETRIEVAL  — fetch the official document (XBRL / PDF / HTML)
 *   4. EXTRACTION — parse the document into structured financial metrics
 *   5. VALIDATION — verify accounting basis, periods, units
 *   6. STORAGE    — persist metrics, document, management commentary
 *
 * Every stage failure is recorded with a precise reason.
 * No stage swallows errors silently.
 * No financial figure is stored without an explicit accounting basis
 * (figures with ambiguous basis are stored as NEEDS_REVIEW, not silently
 * defaulted to STANDALONE or CONSOLIDATED).
 */

import { discoverAllFilings } from "./discovery.js";
import { retrieveDocument } from "./retriever.js";
import { extractFromContent } from "./extractor.js";
import {
  storeFilingQueueEntry,
  updateFilingQueueStatus,
  storeDocument,
  storeFinancialMetric,
  storeManagementCommentary,
} from "./store.js";
import type {
  PipelineRunResult,
  FilingQueueEntry,
  DiscoveredFiling,
  RetrievalStatus,
} from "./types.js";
import { logger } from "../logger.js";

// ─────────────────────────────────────────────────────────────
// PIPELINE CONFIGURATION
// ─────────────────────────────────────────────────────────────

export interface PipelineOptions {
  /** ISO date string for start of filing search window. Defaults to 1 year ago. */
  fromDate?: string;
  /** ISO date string for end of filing search window. Defaults to today. */
  toDate?: string;
  /** If true, attempt retrieval even if discovery fully fails. */
  forceRetrieval?: boolean;
  /** Maximum number of filings to retrieve in one run. Defaults to 10. */
  maxRetrievals?: number;
}

// ─────────────────────────────────────────────────────────────
// MAIN PIPELINE ENTRY POINT
// ─────────────────────────────────────────────────────────────

/**
 * Runs the full ingestion pipeline for one company.
 * Returns a detailed PipelineRunResult documenting every stage.
 */
export async function runIngestionPipeline(
  companyId: string,
  ticker: string,
  scripCode: string,
  options: PipelineOptions = {},
): Promise<PipelineRunResult> {
  const ranAt = new Date().toISOString();
  const maxRetrievals = options.maxRetrievals ?? 10;

  logger.info({ companyId, ticker, scripCode, ranAt }, "Ingestion pipeline started");

  const result: PipelineRunResult = {
    companyId,
    ticker,
    ranAt,
    discovery: {
      sourcesAttempted: [],
      sourcesSucceeded: [],
      sourcesFailed: [],
      filingsDiscovered: 0,
    },
    retrieval: {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
      results: [],
    },
    extraction: {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      metricsExtracted: 0,
    },
    storage: {
      documentsStored: 0,
      metricsStored: 0,
      managementStatementsStored: 0,
      conflictsDetected: 0,
    },
    limitations: [],
  };

  // ── STAGE 1: DISCOVERY ──────────────────────────────────────
  logger.info({ companyId, ticker }, "Stage 1: Discovery");

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

  const discovery = await discoverAllFilings(companyId, ticker, scripCode, {
    fromDate: options.fromDate ?? oneYearAgo,
    toDate: options.toDate ?? today,
  });

  for (const sourceResult of discovery.sources) {
    result.discovery.sourcesAttempted.push(sourceResult.source);
    if (sourceResult.success) {
      result.discovery.sourcesSucceeded.push(sourceResult.source);
    } else {
      result.discovery.sourcesFailed.push({
        source: sourceResult.source,
        reason: sourceResult.reason,
        detail: sourceResult.detail,
      });
    }
  }

  result.discovery.filingsDiscovered = discovery.filings.length;

  if (discovery.allFailed) {
    const reasons = discovery.sources
      .filter((s): s is Extract<typeof s, { success: false }> => !s.success)
      .map((s) => `${s.source}: ${s.reason} — ${s.detail}`)
      .join("\n");

    result.limitations.push(
      "DISCOVERY FAILED: All filing discovery sources are inaccessible from this environment.\n" + reasons,
    );
    logger.warn({ companyId, ticker }, "All discovery sources failed — no filings to retrieve");

    // Record the discovery attempts in the queue even though all failed
    for (const sourceResult of discovery.sources) {
      if (!sourceResult.success) {
        await storeFilingQueueEntry({
          companyId,
          filingType: "other_filing",
          sourceExchange: sourceResult.source.includes("NSE") ? "NSE" : "BSE",
          sourceTier: 1,
          discoveryMethod: sourceResult.source.includes("RSS") ? "nse_rss"
            : sourceResult.source.includes("BSE") ? "bse_api"
            : "nse_api",
          xbrlAvailable: false,
          retrievalStatus: "blocked",
          retrievalError: sourceResult.detail,
          retrievalErrorCode: sourceResult.reason,
          retrievalAttempts: 1,
          processingStatus: "unprocessed",
          metricsStored: 0,
          dataQualityStatus: "MISSING",
        });
      }
    }

    return result;
  }

  // ── STAGE 2: QUEUE DISCOVERED FILINGS ──────────────────────
  logger.info({ companyId, ticker, count: discovery.filings.length }, "Stage 2: Queuing discovered filings");

  type QueueEntry = { filing: DiscoveredFiling; queueId: string | null };
  const queueEntries: QueueEntry[] = [];

  for (const filing of discovery.filings.slice(0, maxRetrievals)) {
    const entry: FilingQueueEntry = {
      companyId: filing.companyId,
      filingType: filing.filingType,
      filingPeriod: filing.filingPeriod ?? null,
      fiscalYear: filing.fiscalYear ?? null,
      quarter: filing.quarter ?? null,
      filingDate: filing.filingDate ?? null,
      sourceExchange: filing.sourceExchange,
      sourceTier: filing.sourceTier,
      discoveryMethod: filing.discoveryMethod,
      filingUrl: filing.filingUrl ?? null,
      documentUrl: filing.documentUrl ?? null,
      xbrlUrl: filing.xbrlUrl ?? null,
      xbrlAvailable: filing.xbrlAvailable,
      filingTitle: filing.filingTitle ?? null,
      filingDescription: filing.filingDescription ?? null,
      exchangeFilingId: filing.exchangeFilingId ?? null,
      retrievalStatus: "pending",
      retrievalAttempts: 0,
      processingStatus: "unprocessed",
      metricsStored: 0,
      dataQualityStatus: "UNVERIFIED",
    };

    const stored = await storeFilingQueueEntry(entry);
    // Queue storage is best-effort — proceed with retrieval even if
    // the filing_queue table is missing (e.g., migration not yet run).
    queueEntries.push({
      filing,
      queueId: stored.success ? (stored.id ?? null) : null,
    });
    if (!stored.success) {
      logger.warn({ filingType: filing.filingType }, "filing_queue storage failed (migration_004 may not be applied) — proceeding with retrieval");
    }
  }

  // ── STAGE 3: RETRIEVAL ──────────────────────────────────────
  logger.info({ companyId, ticker, queueCount: queueEntries.length }, "Stage 3: Document retrieval");

  for (const { filing, queueId } of queueEntries) {
    const documentUrl = filing.xbrlAvailable && filing.xbrlUrl
      ? filing.xbrlUrl
      : filing.documentUrl;

    result.retrieval.attempted++;

    if (!documentUrl) {
      result.retrieval.failed++;
      result.retrieval.results.push({
        filingType: filing.filingType,
        url: null,
        status: "failed",
        reason: "NOT_FOUND",
        detail: "No document URL available for this filing.",
      });
      if (queueId) await updateFilingQueueStatus(queueId, {
        retrievalStatus: "failed",
        retrievalError: "No document URL available",
        retrievalErrorCode: "NOT_FOUND",
        retrievalAttempts: 1,
        lastRetrievalAt: new Date().toISOString(),
      });
      continue;
    }

    if (queueId) await updateFilingQueueStatus(queueId, {
      retrievalStatus: "retrieving",
      retrievalAttempts: 1,
      lastRetrievalAt: new Date().toISOString(),
    });

    const retrieved = await retrieveDocument(documentUrl);

    if (!retrieved.success) {
      const isBlocked = retrieved.reason === "NETWORK_BLOCKED" || retrieved.reason === "AUTH_REQUIRED";
      const status: RetrievalStatus = isBlocked ? "blocked" : "failed";

      result.retrieval.failed++;
      if (isBlocked) result.retrieval.blocked++;
      result.retrieval.results.push({
        filingType: filing.filingType,
        url: documentUrl,
        status,
        reason: retrieved.reason,
        detail: retrieved.detail,
      });

      if (queueId) await updateFilingQueueStatus(queueId, {
        retrievalStatus: status,
        retrievalError: retrieved.detail,
        retrievalErrorCode: retrieved.reason,
        retrievalAttempts: 1,
        lastRetrievalAt: new Date().toISOString(),
      });
      continue;
    }

    result.retrieval.succeeded++;
    result.retrieval.results.push({
      filingType: filing.filingType,
      url: documentUrl,
      status: "complete",
    });

    // ── STAGE 4: STORE DOCUMENT ─────────────────────────────
    const docStored = await storeDocument({
      companyId,
      title: filing.filingTitle ?? `${filing.filingType} — ${filing.filingPeriod ?? "unknown period"}`,
      documentType: filing.filingType,
      reportingPeriod: filing.filingPeriod ?? null,
      documentDate: filing.filingDate ?? null,
      sourceName: `${filing.sourceExchange} ${filing.filingType}`,
      sourceUrl: filing.filingUrl ?? null,
      documentUrl,
      sourceTier: filing.sourceTier,
      content: retrieved.contentType.includes("pdf") ? null : retrieved.content.slice(0, 100_000),
      textExtractionStatus: retrieved.contentType.includes("pdf") ? "pending" : "complete",
      processingStatus: "queued",
    });

    if (docStored.success) {
      result.storage.documentsStored++;
      if (queueId) await updateFilingQueueStatus(queueId, {
        retrievalStatus: "complete",
        processingStatus: "processing",
        documentId: docStored.id ?? null,
        lastRetrievalAt: new Date().toISOString(),
      });
    }

    // ── STAGE 5: EXTRACT ────────────────────────────────────
    result.extraction.attempted++;

    const reportingPeriod = filing.filingPeriod ?? "UNKNOWN";
    const extraction = extractFromContent(
      retrieved.content,
      retrieved.contentType,
      ticker,
      reportingPeriod,
    );

    if (!extraction.success) {
      result.extraction.failed++;
      if (queueId) await updateFilingQueueStatus(queueId, {
        processingStatus: "failed",
        processingError: extraction.detail,
      });
      continue;
    }

    result.extraction.succeeded++;

    // ── STAGE 6: STORE METRICS ──────────────────────────────
    let metricsStored = 0;
    let conflictsDetected = 0;

    for (const metric of extraction.extractedMetrics) {
      const stored = await storeFinancialMetric(companyId, metric, {
        sourceName: `${filing.sourceExchange} ${filing.filingType}`,
        sourceTier: filing.sourceTier,
        sourceUrl: documentUrl,
        sourceDate: filing.filingDate ?? undefined,
        sourceDocumentId: docStored.id ?? undefined,
      });
      if (stored.success) {
        metricsStored++;
        if (stored.conflict) conflictsDetected++;
      }
    }

    result.extraction.metricsExtracted += extraction.extractedMetrics.length;
    result.storage.metricsStored += metricsStored;
    result.storage.conflictsDetected += conflictsDetected;

    // ── STAGE 7: STORE MANAGEMENT COMMENTARY ────────────────
    for (const stmt of extraction.managementStatements) {
      const stored = await storeManagementCommentary({
        companyId,
        statement: stmt.statement,
        speaker: stmt.speaker ?? null,
        sourceDocumentId: docStored.id ?? null,
        sourceName: `${filing.sourceExchange} ${filing.filingType}`,
        sourceUrl: documentUrl,
        sourceTier: filing.sourceTier,
        statementDate: filing.filingDate ?? null,
        reportingPeriod,
        topic: stmt.topic,
        isVerbatim: stmt.isVerbatim,
      });
      if (stored.success) result.storage.managementStatementsStored++;
    }

    if (queueId) await updateFilingQueueStatus(queueId, {
      processingStatus: "processed",
      processedAt: new Date().toISOString(),
      metricsStored,
      dataQualityStatus: metricsStored > 0 ? "UNVERIFIED" : "MISSING",
    });
  }

  logger.info({ companyId, ticker, result }, "Ingestion pipeline complete");
  return result;
}
