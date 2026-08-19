/**
 * Ingestion API Routes
 *
 * GET  /api/ingestion/status                  — pipeline health and queue summary
 * POST /api/ingestion/run                     — trigger a pipeline run for a company
 * POST /api/ingestion/nse-results             — ingest structured NSE financial results
 * POST /api/ingestion/nse-shareholding        — ingest NSE shareholding data
 * GET  /api/ingestion/queue/:companyId        — view filing queue for a company
 * GET  /api/ingestion/metrics/:companyId      — view stored financial metrics
 */

import { Router, type Request, type Response } from "express";
import { runIngestionPipeline } from "../lib/ingestion/pipeline.js";
import { fetchAndExtractNseResults, fetchNseShareholding } from "../lib/ingestion/nse-results.js";
import { storeFinancialMetric } from "../lib/ingestion/store.js";
import { logger } from "../lib/logger.js";

export const ingestionRouter = Router();

// ─────────────────────────────────────────────────────────────
// SUPABASE HELPER (inline — avoids coupling to supabase.ts types)
// ─────────────────────────────────────────────────────────────

async function supabaseGet<T>(path: string): Promise<T[]> {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  const resp = await fetch(`${url}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`Supabase GET failed: ${resp.status}`);
  return resp.json() as Promise<T[]>;
}

// ─────────────────────────────────────────────────────────────
// GET /api/ingestion/status
// ─────────────────────────────────────────────────────────────

ingestionRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    // Each table check is independent — ignore individual failures
    const [queueResult, metricsResult] = await Promise.allSettled([
      supabaseGet<{ retrieval_status: string; processing_status: string }>(
        "/filing_queue?select=retrieval_status,processing_status",
      ),
      supabaseGet<{ id: string }>("/financial_metrics?select=id&limit=1"),
    ]);

    const queueRows = queueResult.status === "fulfilled" ? queueResult.value : [];
    const filingQueueExists = queueResult.status === "fulfilled";
    const financialMetricsExists = metricsResult.status === "fulfilled";

    const queueSummary = queueRows.reduce(
      (acc, row) => {
        acc[row.retrieval_status] = (acc[row.retrieval_status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const migrationNote = (!filingQueueExists)
      ? "⚠️  migration_004_ingestion_queue.sql has not been run yet. Run it in the Supabase SQL Editor to enable the filing queue."
      : null;

    res.json({
      status: "ok",
      pipeline: {
        filingQueueExists,
        filingQueueTotal: queueRows.length,
        queueByRetrievalStatus: queueSummary,
        financialMetricsTableExists: financialMetricsExists,
        migrationNote,
      },
      sources: {
        nse: {
          accessible: false,
          reason: "NSE (nseindia.com) blocks cloud/datacenter IPs at the CDN/WAF level. HTTP 403 or connection refused (HTTP 000) from this environment.",
          workaround: "Deploy from a residential IP, register with NSE as a data vendor, or route traffic through an NSE-approved proxy.",
        },
        bse: {
          accessible: false,
          reason: "BSE API (api.bseindia.com) endpoints have been retired — they now redirect to HTML pages. A vendor API key or browser session is required.",
          workaround: "Register with BSE as a data subscriber or use BSE's official data vendor programme.",
        },
        bseWebsite: {
          accessible: true,
          reason: "www.bseindia.com returns HTTP 200. Document PDFs are downloadable if the exact filing URL (GUID) is known.",
          workaround: "Filing GUIDs can be discovered via the BSE vendor API once access is granted.",
        },
      },
    });
  } catch (err) {
    logger.error({ err }, "Ingestion status error");
    res.status(503).json({ error: "Status check failed", detail: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/ingestion/run
// Body: { companyId, ticker, scripCode, fromDate?, toDate?, maxRetrievals? }
// ─────────────────────────────────────────────────────────────

ingestionRouter.post("/run", async (req: Request, res: Response) => {
  const { companyId, ticker, scripCode, fromDate, toDate, maxRetrievals } = req.body as {
    companyId?: string;
    ticker?: string;
    scripCode?: string;
    fromDate?: string;
    toDate?: string;
    maxRetrievals?: number;
  };

  if (!companyId || !ticker || !scripCode) {
    res.status(400).json({
      error: "companyId, ticker, and scripCode are required",
      example: {
        companyId: "11111111-1111-4111-8111-111111111111",
        ticker: "RELIANCE",
        scripCode: "532712",
      },
    });
    return;
  }

  logger.info({ companyId, ticker, scripCode }, "Ingestion run requested");

  try {
    const result = await runIngestionPipeline(companyId, ticker, scripCode, {
      fromDate,
      toDate,
      maxRetrievals: maxRetrievals ?? 10,
    });

    const overallStatus =
      result.storage.metricsStored > 0
        ? "data_stored"
        : result.retrieval.succeeded > 0
          ? "retrieved_no_metrics"
          : result.discovery.filingsDiscovered > 0
            ? "discovered_not_retrieved"
            : "discovery_failed";

    res.json({
      status: overallStatus,
      result,
    });
  } catch (err) {
    logger.error({ err, companyId, ticker }, "Ingestion run failed");
    res.status(500).json({ error: "Pipeline run failed", detail: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/ingestion/nse-results
// Body: { companyId, ticker }
// Fetches 5 quarters of structured financial results from NSE
// results-comparision API and stores them in financial_metrics.
// No PDF or XBRL parsing needed — fully structured JSON source.
// ─────────────────────────────────────────────────────────────

ingestionRouter.post("/nse-results", async (req: Request, res: Response) => {
  const { companyId, ticker } = req.body as { companyId?: string; ticker?: string };
  if (!companyId || !ticker) {
    res.status(400).json({
      error: "companyId and ticker are required",
      example: { companyId: "11111111-1111-4111-8111-111111111111", ticker: "RELIANCE" },
    });
    return;
  }

  logger.info({ companyId, ticker }, "NSE structured results ingestion requested");

  try {
    const extracted = await fetchAndExtractNseResults(ticker);

    if (!extracted.success) {
      res.status(502).json({
        status: "fetch_failed",
        ticker,
        error: extracted.error,
        httpStatus: extracted.httpStatus,
      });
      return;
    }

    // Store each metric in financial_metrics with full lineage
    let metricsStored = 0;
    let metricsConflict = 0;
    let metricsFailed = 0;
    const storageErrors: string[] = [];

    for (const metric of extracted.metrics) {
      const stored = await storeFinancialMetric(companyId, metric, {
        sourceName: "NSE Results Comparison API",
        sourceTier: 1,
        sourceUrl: `https://www.nseindia.com/api/results-comparision?index=equities&symbol=${ticker}`,
        sourceDate: new Date().toISOString().slice(0, 10),
      });
      if (stored.success) {
        metricsStored++;
        if (stored.conflict) metricsConflict++;
      } else {
        metricsFailed++;
        if (storageErrors.length < 5) storageErrors.push(stored.error ?? "unknown");
      }
    }

    logger.info({ companyId, ticker, metricsStored, metricsFailed }, "NSE results stored");

    res.json({
      status: metricsStored > 0 ? "success" : "stored_nothing",
      ticker,
      companyId,
      source: "NSE Results Comparison API (https://nseindia.com/api/results-comparision)",
      sourceTier: 1,
      dataNote: "Structured JSON response — no PDF or XBRL parsing required",
      periodsFound: extracted.periodsFound,
      periods: extracted.periods,
      metricsExtracted: extracted.metrics.length,
      metricsStored,
      metricsConflict,
      metricsFailed,
      storageErrors: storageErrors.length > 0 ? storageErrors : undefined,
    });
  } catch (err) {
    logger.error({ err, companyId, ticker }, "NSE results ingestion failed");
    res.status(500).json({ error: "NSE results ingestion failed", detail: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/ingestion/nse-shareholding
// Body: { companyId, ticker }
// Fetches shareholding pattern from NSE and stores it.
// ─────────────────────────────────────────────────────────────

ingestionRouter.post("/nse-shareholding", async (req: Request, res: Response) => {
  const { companyId, ticker } = req.body as { companyId?: string; ticker?: string };
  if (!companyId || !ticker) {
    res.status(400).json({ error: "companyId and ticker are required" });
    return;
  }

  try {
    const result = await fetchNseShareholding(ticker);
    res.json({
      status: result.success ? "fetched" : "failed",
      ticker,
      companyId,
      source: "NSE Shareholding Equity API",
      sourceTier: 1,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/ingestion/queue/:companyId
// ─────────────────────────────────────────────────────────────

ingestionRouter.get("/queue/:companyId", async (req: Request, res: Response) => {
  const { companyId } = req.params;
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  try {
    const rows = await supabaseGet(
      `/filing_queue?company_id=eq.${encodeURIComponent(String(companyId))}&order=created_at.desc&limit=50`,
    );
    res.json({ companyId, total: rows.length, entries: rows });
  } catch (err) {
    res.status(503).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/ingestion/metrics/:companyId
// ─────────────────────────────────────────────────────────────

ingestionRouter.get("/metrics/:companyId", async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const basis = typeof req.query.basis === "string" ? req.query.basis : undefined;
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  try {
    const params = new URLSearchParams({
      company_id: `eq.${companyId}`,
      select: "metric_name,metric_value,metric_unit,currency,reporting_period,accounting_basis,entity_name,source_name,source_tier,data_quality_status",
      order: "reporting_period.desc,metric_name.asc",
      limit: "200",
    });
    if (basis) params.set("accounting_basis", `eq.${basis}`);
    if (period) params.set("reporting_period", `eq.${period}`);

    const rows = await supabaseGet(`/financial_metrics?${params.toString()}`);
    res.json({ companyId, total: rows.length, metrics: rows });
  } catch (err) {
    res.status(503).json({ error: String(err) });
  }
});
