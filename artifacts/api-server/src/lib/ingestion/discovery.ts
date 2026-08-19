/**
 * Filing Discovery — tries every configured source and returns what it finds.
 *
 * Architecture:
 *   NSE RSS  → notifies of new filings (discovery/notification layer only)
 *   BSE API  → filing listing with metadata
 *   NSE API  → filing listing with metadata
 *
 * IMPORTANT: These sources are DISCOVERY only.  They identify that a filing
 * exists and provide its URL.  The actual financial data is retrieved by
 * retriever.ts from the official document (PDF / XBRL / HTML) at that URL.
 *
 * When a source is inaccessible, this module returns a structured failure
 * with the exact reason.  It never silently falls back or invents data.
 */

import type { DiscoveryResult, DiscoveredFiling, FilingType } from "./types.js";
import type { IngestionErrorReason } from "./types.js";
import { NSE_FILING_TYPE_MAP, BSE_FILING_TYPE_MAP } from "./types.js";
import { logger } from "../logger.js";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

/** NSE corporate announcements API — requires session cookie (blocked for cloud IPs) */
const NSE_ANNOUNCEMENTS_URL =
  "https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=";

/** NSE financial results API — requires session cookie (blocked for cloud IPs) */
const NSE_RESULTS_URL =
  "https://www.nseindia.com/api/results-comparision?index=equities&symbol=";

/** NSE shareholding API — requires session cookie (blocked for cloud IPs) */
const NSE_SHAREHOLDING_URL =
  "https://www.nseindia.com/api/corporate-shareholding-equity?index=equities&symbol=";

/**
 * BSE filings API — old endpoint structure redirects to website HTML.
 * Retained for future use if BSE restores structured API access.
 */
const BSE_FILINGS_URL = "https://api.bseindia.com/BseIndiaAPI/api/Filings/w";

const REQUEST_TIMEOUT_MS = 15_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/html, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function classifyHttpError(
  status: number,
  url: string,
): { reason: IngestionErrorReason; detail: string } {
  if (status === 403 || status === 401) {
    return {
      reason: "AUTH_REQUIRED" as const,
      detail: `HTTP ${status} from ${url}. NSE and BSE block cloud/datacenter IP ranges via WAF. A session cookie obtained from a browser is required. Deploy from a residential or allowed IP, or use an authorised data vendor.`,
    };
  }
  if (status === 404) {
    return {
      reason: "NOT_FOUND" as const,
      detail: `HTTP 404 from ${url}. Endpoint does not exist or has been retired.`,
    };
  }
  if (status === 429) {
    return {
      reason: "RATE_LIMITED" as const,
      detail: `HTTP 429 from ${url}. Rate limited. Back off and retry.`,
    };
  }
  if (status === 301 || status === 302) {
    return {
      reason: "ENDPOINT_CHANGED" as const,
      detail: `HTTP ${status} from ${url}. Endpoint has moved. The BSE API endpoint structure has changed — the API now redirects to HTML pages rather than returning JSON.`,
    };
  }
  return {
    reason: "UNKNOWN" as const,
    detail: `HTTP ${status} from ${url}`,
  };
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// NSE RSS DISCOVERY
// NSE operates an RSS feed for corporate announcements.
// Role: notification/discovery layer only — not a data source.
// ─────────────────────────────────────────────────────────────

/**
 * Attempts to read the NSE corporate announcement RSS feed for a symbol.
 *
 * Known limitation: NSE blocks cloud/datacenter IPs at the CDN/WAF level.
 * HTTP 000 (connection refused) or HTTP 403 are the expected failures
 * from a Replit or cloud server.  This function documents the failure
 * precisely so the operator can resolve it (e.g., IP allowlisting, proxy).
 */
export async function discoverFromNseRss(
  symbol: string,
): Promise<DiscoveryResult> {
  const source = "NSE RSS";
  const url = `${NSE_ANNOUNCEMENTS_URL}${encodeURIComponent(symbol)}`;

  logger.info({ source, symbol, url }, "Attempting NSE discovery");

  try {
    const resp = await fetchWithTimeout(url, { headers: BROWSER_HEADERS });

    if (!resp.ok) {
      const { reason, detail } = classifyHttpError(resp.status, url);
      logger.warn({ source, symbol, status: resp.status, reason }, "NSE discovery failed");
      return { success: false, source, reason, httpStatus: resp.status, detail };
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return {
        success: false,
        source,
        reason: "PARSING_FAILED",
        httpStatus: resp.status,
        detail: `Expected JSON but received ${contentType}. NSE may have returned an HTML page — session cookie likely required.`,
      };
    }

    const data = (await resp.json()) as unknown[];
    if (!Array.isArray(data)) {
      return {
        success: false,
        source,
        reason: "PARSING_FAILED",
        httpStatus: resp.status,
        detail: "Response was not a JSON array.",
      };
    }

    const filings: DiscoveredFiling[] = data.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const row = item as Record<string, unknown>;
      const category = String(row["subject"] ?? row["category"] ?? "");
      const filingType: FilingType = NSE_FILING_TYPE_MAP[category] ?? "other_filing";
      const filing: DiscoveredFiling = {
        companyId: "",
        ticker: symbol,
        filingType,
        filingPeriod: String(row["period"] ?? ""),
        filingDate: String(row["date"] ?? row["timestamp"] ?? ""),
        sourceExchange: "NSE",
        sourceTier: 1,
        discoveryMethod: "nse_rss",
        filingTitle: String(row["subject"] ?? row["desc"] ?? ""),
        exchangeFilingId: String(row["recordId"] ?? row["id"] ?? ""),
        filingUrl: typeof row["attchmntFile"] === "string" ? row["attchmntFile"] : null,
        documentUrl: typeof row["attchmntFile"] === "string" ? row["attchmntFile"] : null,
        xbrlAvailable: false,
      };
      return [filing];
    });

    logger.info({ source, symbol, count: filings.length }, "NSE discovery succeeded");
    return { success: true, source, filings };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const isNetwork = err instanceof TypeError && err.message.includes("fetch");
    logger.error({ source, symbol, err }, "NSE discovery network error");

    if (isTimeout) {
      return {
        success: false,
        source,
        reason: "SOURCE_UNREACHABLE",
        httpStatus: null,
        detail: `Connection timed out after ${REQUEST_TIMEOUT_MS}ms. NSE blocks cloud server IPs — the TCP connection is refused at the network level before a response is received.`,
      };
    }
    if (isNetwork) {
      return {
        success: false,
        source,
        reason: "NETWORK_BLOCKED",
        httpStatus: null,
        detail: `Network error: ${String(err)}. NSE (nseindia.com) is not reachable from this cloud environment. Their CDN/WAF (Cloudflare) blocks cloud datacenter IP ranges. This is a network-level block, not an authentication issue.`,
      };
    }
    return {
      success: false,
      source,
      reason: "UNKNOWN",
      httpStatus: null,
      detail: String(err),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// NSE API DISCOVERY (Financial Results + Shareholding)
// ─────────────────────────────────────────────────────────────

export async function discoverFromNseApi(symbol: string): Promise<DiscoveryResult> {
  const source = "NSE API (Financial Results)";
  const url = `${NSE_RESULTS_URL}${encodeURIComponent(symbol)}`;

  logger.info({ source, symbol, url }, "Attempting NSE financial results discovery");

  try {
    const resp = await fetchWithTimeout(url, { headers: BROWSER_HEADERS });
    if (!resp.ok) {
      const { reason, detail } = classifyHttpError(resp.status, url);
      return { success: false, source, reason, httpStatus: resp.status, detail };
    }
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return {
        success: false,
        source,
        reason: "PARSING_FAILED",
        httpStatus: resp.status,
        detail: `Expected JSON but received ${contentType}. NSE session cookie required.`,
      };
    }
    const data = (await resp.json()) as unknown;
    const filings: DiscoveredFiling[] = parseNseResultsResponse(data, symbol);
    return { success: true, source, filings };
  } catch (err) {
    return {
      success: false,
      source,
      reason: (err instanceof Error && err.name === "AbortError") ? "SOURCE_UNREACHABLE" : "NETWORK_BLOCKED",
      httpStatus: null,
      detail: `NSE API not reachable from cloud environment: ${String(err)}`,
    };
  }
}

function parseNseResultsResponse(data: unknown, symbol: string): DiscoveredFiling[] {
  if (!data || typeof data !== "object") return [];
  const rows = Array.isArray(data) ? data : (data as Record<string, unknown[]>)["results"] ?? [];
  return (rows as Record<string, unknown>[]).map((row) => ({
    companyId: "",
    ticker: symbol,
    filingType: "quarterly_result" as FilingType,
    filingPeriod: String(row["period"] ?? ""),
    filingDate: String(row["xbrl_date"] ?? row["date"] ?? ""),
    sourceExchange: "NSE" as const,
    sourceTier: 1 as const,
    discoveryMethod: "nse_api" as const,
    filingTitle: String(row["desc"] ?? ""),
    exchangeFilingId: String(row["seqno"] ?? ""),
    filingUrl: typeof row["xbrl"] === "string" ? row["xbrl"] : null,
    documentUrl: typeof row["xbrl"] === "string" ? row["xbrl"] : null,
    xbrlUrl: typeof row["xbrl"] === "string" ? row["xbrl"] : null,
    xbrlAvailable: typeof row["xbrl"] === "string" && row["xbrl"] !== "",
  }));
}

// ─────────────────────────────────────────────────────────────
// BSE API DISCOVERY
// ─────────────────────────────────────────────────────────────

/**
 * Attempts to discover filings from BSE's structured API.
 *
 * Known limitation: BSE's api.bseindia.com endpoints now redirect
 * to www.bseindia.com HTML pages rather than returning JSON.
 * The old endpoint structure (used until ~2024) is no longer active.
 */
export async function discoverFromBseApi(
  scripCode: string,
  category: string,
  fromDate: string,
  toDate: string,
): Promise<DiscoveryResult> {
  const source = `BSE API (${category})`;
  const params = new URLSearchParams({
    strId: scripCode,
    Category: category,
    Index: "C",
    Type: "E",
    Fdate: fromDate,
    ToDate: toDate,
    subcategory: "",
  });
  const url = `${BSE_FILINGS_URL}?${params.toString()}`;

  logger.info({ source, scripCode, category, url }, "Attempting BSE discovery");

  try {
    const resp = await fetchWithTimeout(url, {
      headers: { ...BROWSER_HEADERS, Referer: "https://www.bseindia.com/" },
      redirect: "manual",
    });

    if (resp.status === 301 || resp.status === 302) {
      return {
        success: false,
        source,
        reason: "ENDPOINT_CHANGED",
        httpStatus: resp.status,
        detail: `BSE API redirects (HTTP ${resp.status}) to www.bseindia.com — the structured JSON API endpoint (api.bseindia.com) has been retired and now returns HTML. BSE filing discovery requires either BSE's official data vendor API or a browser session.`,
      };
    }

    if (!resp.ok) {
      const { reason, detail } = classifyHttpError(resp.status, url);
      return { success: false, source, reason, httpStatus: resp.status, detail };
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return {
        success: false,
        source,
        reason: "ENDPOINT_CHANGED",
        httpStatus: resp.status,
        detail: `BSE API returned ${contentType} instead of JSON. The endpoint has been retired.`,
      };
    }

    const data = (await resp.json()) as { Table?: Record<string, unknown>[] };
    const rows = data?.Table ?? [];
    const filings: DiscoveredFiling[] = rows.map((row) => {
      const cat = String(row["CATEGORYNAME"] ?? row["Category"] ?? "");
      return {
        companyId: "",
        ticker: "",
        filingType: BSE_FILING_TYPE_MAP[cat] ?? "other_filing",
        filingPeriod: String(row["PERIOD"] ?? ""),
        filingDate: String(row["FILLINGDATE"] ?? row["DATE"] ?? ""),
        sourceExchange: "BSE" as const,
        sourceTier: 1 as const,
        discoveryMethod: "bse_api" as const,
        filingTitle: String(row["HEADLINE"] ?? ""),
        exchangeFilingId: String(row["NEWSID"] ?? ""),
        filingUrl: typeof row["ATTACHMENTNAME"] === "string"
          ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${row["ATTACHMENTNAME"]}`
          : null,
        documentUrl: typeof row["ATTACHMENTNAME"] === "string"
          ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${row["ATTACHMENTNAME"]}`
          : null,
        xbrlAvailable: false,
      };
    });

    logger.info({ source, scripCode, count: filings.length }, "BSE discovery succeeded");
    return { success: true, source, filings };
  } catch (err) {
    return {
      success: false,
      source,
      reason: "NETWORK_BLOCKED",
      httpStatus: null,
      detail: `BSE API network error: ${String(err)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// AGGREGATE DISCOVERY
// Tries all sources for a company and returns combined results.
// ─────────────────────────────────────────────────────────────

export interface AggregateDiscoveryResult {
  sources: DiscoveryResult[];
  filings: DiscoveredFiling[];
  allFailed: boolean;
}

export async function discoverAllFilings(
  companyId: string,
  symbol: string,
  scripCode: string,
  options: {
    fromDate?: string;
    toDate?: string;
  } = {},
): Promise<AggregateDiscoveryResult> {
  const today = new Date();
  const toDate = options.toDate ?? today.toLocaleDateString("en-GB").replace(/\//g, "/");
  const fromDate =
    options.fromDate ??
    new Date(today.setFullYear(today.getFullYear() - 1))
      .toLocaleDateString("en-GB")
      .replace(/\//g, "/");

  logger.info({ companyId, symbol, scripCode, fromDate, toDate }, "Starting aggregate filing discovery");

  const results = await Promise.all([
    discoverFromNseRss(symbol),
    discoverFromNseApi(symbol),
    discoverFromBseApi(scripCode, "Financial Results", fromDate, toDate),
    discoverFromBseApi(scripCode, "Shareholding Pattern", fromDate, toDate),
    discoverFromBseApi(scripCode, "Annual Report", fromDate, toDate),
  ]);

  const allFilings: DiscoveredFiling[] = results
    .filter((r): r is Extract<DiscoveryResult, { success: true }> => r.success)
    .flatMap((r) => r.filings.map((f) => ({ ...f, companyId })));

  const allFailed = results.every((r) => !r.success);

  return { sources: results, filings: allFilings, allFailed };
}
