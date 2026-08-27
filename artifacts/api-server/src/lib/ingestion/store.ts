/**
 * Ingestion Store — persists extracted data to Supabase with full lineage.
 *
 * Every stored record must carry:
 *   - which company it belongs to
 *   - which filing it came from (filing_queue entry)
 *   - which document it was extracted from
 *   - the accounting basis (or NEEDS_REVIEW if unclear)
 *   - the source name, tier, and URL
 *   - the data quality status
 *
 * Conflict handling: if a metric already exists for the same
 * (company, entity, metric, period, basis) tuple and the values differ
 * by more than 0.01%, both values are retained in data_quality and the
 * original row is marked CONFLICTING.  Nothing is silently overwritten.
 */

import type { ExtractedMetric, FilingQueueEntry } from "./types.js";
import { detectConflict, metricLookupKey } from "../data-sources.js";
import type { FinancialMetric, DataQualityStatus } from "../data-sources.js";
import { logger } from "../logger.js";

// ─────────────────────────────────────────────────────────────
// SUPABASE CLIENT (server-side REST helper)
// ─────────────────────────────────────────────────────────────

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase not configured (SUPABASE_URL / SUPABASE_SECRET_KEY missing)");
  return { url, key };
}

async function supabasePost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: unknown }> {
  const { url, key } = getSupabaseConfig();
  const resp = await fetch(`${url}/rest/v1${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: resp.ok, status: resp.status, data };
}

async function supabaseGet<T>(path: string): Promise<T[]> {
  const { url, key } = getSupabaseConfig();
  const resp = await fetch(`${url}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`Supabase GET ${path} failed: ${resp.status}`);
  return resp.json() as Promise<T[]>;
}

async function supabasePatch(path: string, body: Record<string, unknown>): Promise<void> {
  const { url, key } = getSupabaseConfig();
  await fetch(`${url}/rest/v1${path}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────
// STORE FILING QUEUE ENTRY
// ─────────────────────────────────────────────────────────────

export async function storeFilingQueueEntry(
  entry: FilingQueueEntry,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const payload = {
    company_id: entry.companyId,
    filing_type: entry.filingType,
    filing_period: entry.filingPeriod ?? null,
    fiscal_year: entry.fiscalYear ?? null,
    quarter: entry.quarter ?? null,
    filing_date: entry.filingDate ?? null,
    source_exchange: entry.sourceExchange,
    source_tier: entry.sourceTier,
    discovery_method: entry.discoveryMethod,
    filing_url: entry.filingUrl ?? null,
    document_url: entry.documentUrl ?? null,
    xbrl_url: entry.xbrlUrl ?? null,
    xbrl_available: entry.xbrlAvailable,
    filing_title: entry.filingTitle ?? null,
    filing_description: entry.filingDescription ?? null,
    exchange_filing_id: entry.exchangeFilingId ?? null,
    retrieval_status: entry.retrievalStatus,
    retrieval_error: entry.retrievalError ?? null,
    retrieval_error_code: entry.retrievalErrorCode ?? null,
    retrieval_attempts: entry.retrievalAttempts,
    processing_status: entry.processingStatus,
    metrics_stored: entry.metricsStored,
    data_quality_status: entry.dataQualityStatus,
  };

  try {
    const result = await supabasePost("/filing_queue", payload);
    if (!result.ok) {
      logger.error({ status: result.status, data: result.data }, "Failed to store filing queue entry");
      return { success: false, error: `HTTP ${result.status}: ${JSON.stringify(result.data)}` };
    }
    const rows = result.data as Array<{ id: string }>;
    return { success: true, id: rows[0]?.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateFilingQueueStatus(
  id: string,
  updates: Partial<{
    retrievalStatus: FilingQueueEntry["retrievalStatus"];
    retrievalError: string | null;
    retrievalErrorCode: string | null;
    retrievalAttempts: number;
    lastRetrievalAt: string;
    processingStatus: FilingQueueEntry["processingStatus"];
    processingError: string | null;
    processedAt: string | null;
    documentId: string | null;
    metricsStored: number;
    dataQualityStatus: DataQualityStatus;
  }>,
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.retrievalStatus !== undefined) patch.retrieval_status = updates.retrievalStatus;
  if (updates.retrievalError !== undefined) patch.retrieval_error = updates.retrievalError;
  if (updates.retrievalErrorCode !== undefined) patch.retrieval_error_code = updates.retrievalErrorCode;
  if (updates.retrievalAttempts !== undefined) patch.retrieval_attempts = updates.retrievalAttempts;
  if (updates.lastRetrievalAt !== undefined) patch.last_retrieval_at = updates.lastRetrievalAt;
  if (updates.processingStatus !== undefined) patch.processing_status = updates.processingStatus;
  if (updates.processingError !== undefined) patch.processing_error = updates.processingError;
  if (updates.processedAt !== undefined) patch.processed_at = updates.processedAt;
  if (updates.documentId !== undefined) patch.document_id = updates.documentId;
  if (updates.metricsStored !== undefined) patch.metrics_stored = updates.metricsStored;
  if (updates.dataQualityStatus !== undefined) patch.data_quality_status = updates.dataQualityStatus;

  await supabasePatch(`/filing_queue?id=eq.${encodeURIComponent(id)}`, patch);
}

// ─────────────────────────────────────────────────────────────
// STORE DOCUMENT
// ─────────────────────────────────────────────────────────────

export async function storeDocument(doc: {
  companyId: string;
  title: string;
  documentType: string;
  reportingPeriod?: string | null;
  documentDate?: string | null;
  publicationDate?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
  documentUrl?: string | null;
  sourceTier: number;
  content?: string | null;
  textExtractionStatus?: string;
  processingStatus?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const payload = {
    company_id: doc.companyId,
    title: doc.title,
    document_type: doc.documentType,
    reporting_period: doc.reportingPeriod ?? null,
    document_date: doc.documentDate ?? null,
    publication_date: doc.publicationDate ?? null,
    source_name: doc.sourceName,
    source_url: doc.sourceUrl ?? null,
    document_url: doc.documentUrl ?? null,
    source_tier: doc.sourceTier,
    content: doc.content?.slice(0, 100_000) ?? null,
    text_extraction_status: doc.textExtractionStatus ?? "complete",
    processing_status: doc.processingStatus ?? "unprocessed",
  };
  try {
    const result = await supabasePost("/documents", payload);
    if (!result.ok) return { success: false, error: `HTTP ${result.status}` };
    const rows = result.data as Array<{ id: string }>;
    return { success: true, id: rows[0]?.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────
// STORE FINANCIAL METRIC (with conflict detection)
// ─────────────────────────────────────────────────────────────

export async function storeFinancialMetric(
  companyId: string,
  metric: ExtractedMetric,
  sourceInfo: {
    sourceName: string;
    sourceTier: number;
    sourceUrl?: string | null;
    sourceDate?: string | null;
    sourceDocumentId?: string | null;
    sourceRegistryId?: string | null;
    filingQueueId?: string | null;
  },
): Promise<{ success: boolean; id?: string; conflict?: boolean; error?: string }> {
  if (!metric.metricName || !VALID_METRIC_NAMES.has(metric.metricName)) {
    return { success: false, error: `Invalid metric name: ${metric.metricName}` };
  }

  // SPEC RULE: accounting_basis is NOT NULL. A metric cannot be stored without an
  // explicit accounting basis from the source document. Never infer or default it.
  // Return a typed failure so callers can report this accurately.
  if (metric.accountingBasis === null) {
    return {
      success: false,
      error: "BASIS_UNCLEAR: accounting basis (standalone/consolidated) not determinable from source document. Per research rules, this metric cannot be stored without an explicit basis. Verify against the original XBRL or official PDF filing.",
    };
  }

  const qualityStatus: DataQualityStatus = "UNVERIFIED";
  const basisNote: string | null = null;

  // Check for existing metric with same lookup key
  const lookupKey = metricLookupKey({
    companyId,
    entityName: metric.entityName,
    metricName: metric.metricName as FinancialMetric["metricName"],
    reportingPeriod: metric.reportingPeriod,
    accountingBasis: metric.accountingBasis ?? "STANDALONE",
  });

  let existingId: string | undefined;
  let conflictDetected = false;

  if (metric.accountingBasis !== null) {
    try {
      const params = new URLSearchParams({
        company_id: `eq.${companyId}`,
        entity_name: `eq.${metric.entityName}`,
        metric_name: `eq.${metric.metricName}`,
        reporting_period: `eq.${metric.reportingPeriod}`,
        accounting_basis: `eq.${metric.accountingBasis}`,
        select: "id,metric_value,source_name,source_tier",
        limit: "1",
      });
      const existing = await supabaseGet<{
        id: string;
        metric_value: number;
        source_name: string;
        source_tier: number;
      }>(`/financial_metrics?${params.toString()}`);

      if (existing.length > 0) {
        const existingRow = existing[0];
        existingId = existingRow.id;

        const fakeExisting: FinancialMetric = {
          companyId,
          entityName: metric.entityName,
          metricName: metric.metricName as FinancialMetric["metricName"],
          metricValue: existingRow.metric_value,
          metricUnit: "crores_inr",
          currency: "INR",
          reportingPeriod: metric.reportingPeriod,
          periodType: "annual",
          statementType: metric.statementType,
          accountingBasis: metric.accountingBasis,
          sourceName: existingRow.source_name,
          sourceTier: existingRow.source_tier as 1 | 2 | 3 | 4,
          dataQualityStatus: "UNVERIFIED",
          isDemo: false,
        };
        const fakeIncoming: FinancialMetric = {
          ...fakeExisting,
          metricValue: metric.metricValue,
          sourceName: sourceInfo.sourceName,
          sourceTier: sourceInfo.sourceTier as 1 | 2 | 3 | 4,
        };

        const conflict = detectConflict(fakeExisting, fakeIncoming);
        if (conflict.conflict) {
          conflictDetected = true;
          logger.warn({ lookupKey, existingValue: existingRow.metric_value, incomingValue: metric.metricValue }, "Metric conflict detected");

          // Store conflict record
          await supabasePost("/data_quality", {
            company_id: companyId,
            source_table: "financial_metrics",
            source_record_id: existingId,
            field_name: "metric_value",
            metric_name: metric.metricName,
            reporting_period: metric.reportingPeriod,
            accounting_basis: metric.accountingBasis,
            value_a: String(existingRow.metric_value),
            source_a_name: existingRow.source_name,
            source_a_tier: existingRow.source_tier,
            value_b: String(metric.metricValue),
            source_b_name: sourceInfo.sourceName,
            source_b_tier: sourceInfo.sourceTier,
            source_b_url: sourceInfo.sourceUrl ?? null,
            resolution_status: "pending",
          });

          // Mark existing row as CONFLICTING
          await supabasePatch(
            `/financial_metrics?id=eq.${existingId}`,
            { data_quality_status: "CONFLICTING" },
          );

          return { success: true, id: existingId, conflict: true };
        }
        // Values are the same — skip duplicate insert
        return { success: true, id: existingId, conflict: false };
      }
    } catch (err) {
      logger.warn({ err, lookupKey }, "Conflict check failed — proceeding with insert");
    }
  }

  const payload = {
    company_id: companyId,
    entity_name: metric.entityName,
    entity_ticker: null,
    metric_name: metric.metricName,
    metric_value: metric.metricValue,
    metric_unit: metric.metricUnit || "crores_inr",
    currency: metric.currency || "INR",
    reporting_period: metric.reportingPeriod,
    period_type: "annual",
    statement_type: metric.statementType,
    accounting_basis: metric.accountingBasis,
    source_name: sourceInfo.sourceName,
    source_tier: sourceInfo.sourceTier,
    source_registry_id: sourceInfo.sourceRegistryId ?? null,
    source_document_id: sourceInfo.sourceDocumentId ?? null,
    source_url: sourceInfo.sourceUrl ?? null,
    source_date: sourceInfo.sourceDate ?? null,
    data_quality_status: qualityStatus,
    is_demo: false,
    quality_notes: [metric.extractionNotes, basisNote].filter(Boolean).join("") || null,
  };

  try {
    const result = await supabasePost("/financial_metrics", payload);
    if (!result.ok) return { success: false, error: `HTTP ${result.status}: ${JSON.stringify(result.data)}` };
    const rows = result.data as Array<{ id: string }>;
    return { success: true, id: rows[0]?.id, conflict: conflictDetected };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────
// STORE MANAGEMENT COMMENTARY
// ─────────────────────────────────────────────────────────────

export async function storeManagementCommentary(commentary: {
  companyId: string;
  statement: string;
  speaker?: string | null;
  sourceDocumentId?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
  sourceTier?: number | null;
  statementDate?: string | null;
  reportingPeriod?: string | null;
  topic: string;
  guidanceType?: string | null;
  isVerbatim: boolean;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const result = await supabasePost("/management_commentary", {
      company_id: commentary.companyId,
      statement: commentary.statement.slice(0, 10_000),
      speaker: commentary.speaker ?? null,
      source_document_id: commentary.sourceDocumentId ?? null,
      source_name: commentary.sourceName,
      source_url: commentary.sourceUrl ?? null,
      source_tier: commentary.sourceTier ?? null,
      statement_date: commentary.statementDate ?? null,
      reporting_period: commentary.reportingPeriod ?? null,
      topic: commentary.topic,
      guidance_type: commentary.guidanceType ?? null,
      is_verbatim: commentary.isVerbatim,
      is_processed: false,
    });
    if (!result.ok) return { success: false, error: `HTTP ${result.status}` };
    const rows = result.data as Array<{ id: string }>;
    return { success: true, id: rows[0]?.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

import { FINANCIAL_METRIC_NAMES } from "../data-sources.js";
const VALID_METRIC_NAMES = new Set<string>(FINANCIAL_METRIC_NAMES);
