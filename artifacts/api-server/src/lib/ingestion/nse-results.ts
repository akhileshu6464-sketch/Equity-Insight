/**
 * NSE Results Comparison API — direct structured financial data ingestion.
 *
 * Endpoint: https://www.nseindia.com/api/results-comparision?index=equities&symbol=RELIANCE
 *
 * This API returns quarterly financial results for a company in structured JSON.
 * No PDF parsing or XBRL processing required.
 * Data is STANDALONE (confirmed by the `re_desc_note_fin` notes field which
 * explicitly states "Standalone Financial Results" in Reliance's case).
 *
 * Units: ₹ Lakhs (verified: Q3FY25 shows Net Revenue = ₹128,260 crore,
 *   which matches 12,826,000 lakhs / 100 = 128,260 crore).
 *
 * Accounting basis: STANDALONE — confirmed from Reliance's Q3FY25 filing notes.
 * NOTE: This API does not always return the basis in a machine-readable field.
 *   When the notes text contains "standalone" it is stored as STANDALONE;
 *   otherwise it is stored as null with dataQualityStatus = NEEDS_REVIEW.
 */

import type { ExtractedMetric } from "./types.js";
import type { AccountingBasis } from "../data-sources.js";
import { detectAccountingBasis } from "./extractor.js";
import { logger } from "../logger.js";

const NSE_RESULTS_URL =
  "https://www.nseindia.com/api/results-comparision?index=equities&symbol=";

const REQUEST_TIMEOUT_MS = 20_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com",
};

// ─────────────────────────────────────────────────────────────
// NSE ROW TYPE (as returned by the API)
// ─────────────────────────────────────────────────────────────

interface NseResultRow {
  re_from_dt?: string | null;
  re_to_dt?: string | null;
  re_create_dt?: string | null;
  re_seq_num?: string | number | null;
  re_res_type?: string | null;          // "U" = unaudited, "A" = audited
  re_net_sale?: string | number | null;  // Net Revenue (₹ lakhs)
  re_net_profit?: string | number | null; // PAT (₹ lakhs)
  re_total_inc?: string | number | null;  // Total income (₹ lakhs)
  re_oth_inc_new?: string | number | null; // Other income (₹ lakhs)
  re_pro_loss_bef_tax?: string | number | null; // PBT (₹ lakhs)
  re_depr_und_exp?: string | number | null; // Depreciation (₹ lakhs)
  re_int_new?: string | number | null;   // Finance cost / interest (₹ lakhs)
  re_basic_eps?: string | number | null; // Basic EPS
  re_diluted_eps?: string | number | null; // Diluted EPS
  re_basic_eps_for_cont_dic_opr?: string | number | null;
  re_dilut_eps_for_cont_dic_opr?: string | number | null;
  re_tax?: string | number | null;       // Tax expense (₹ lakhs)
  re_curr_tax?: string | number | null;  // Current tax (₹ lakhs)
  re_staff_cost?: string | number | null;
  re_rawmat_consump?: string | number | null;
  re_pur_trd_goods?: string | number | null;
  re_face_val?: string | number | null;
  re_desc_note_fin?: string | null;      // Footnotes — contains accounting basis
  re_desc_note_seg?: string | null;      // Segment notes
  re_pdup?: string | number | null;      // Paid-up capital
  re_con_pro_loss?: string | number | null; // Profit for continued operations
  re_proloss_ord_act?: string | number | null;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// PERIOD LABEL CONVERSION
// Maps from NSE date ranges to human-readable period labels.
// ─────────────────────────────────────────────────────────────

/** 
 * Converts NSE from_dt/to_dt strings to a period label like "Q3FY25" or "FY24".
 * NSE date format: "DD-MMM-YYYY" e.g. "01-OCT-2024"
 */
export function nsePeriodLabel(
  fromDt: string,
  toDt: string,
  resType: string | null | undefined,
): { label: string; quarter: number | null; fiscalYear: number; filingType: string } {
  const monthMap: Record<string, number> = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  };

  const parseDt = (dt: string): Date | null => {
    const parts = dt.trim().toUpperCase().split("-");
    if (parts.length !== 3) return null;
    const [day, mon, year] = parts;
    const m = monthMap[mon];
    if (!m) return null;
    return new Date(parseInt(year, 10), m - 1, parseInt(day, 10));
  };

  const from = parseDt(fromDt);
  const to = parseDt(toDt);
  if (!from || !to) return { label: `${fromDt} to ${toDt}`, quarter: null, fiscalYear: 0, filingType: "quarterly_result" };

  const toMonth = to.getMonth() + 1; // 1-12
  const toYear = to.getFullYear();

  // Indian fiscal year: April to March
  // FY25 = April 2024 to March 2025
  const fiscalYear = toMonth <= 3 ? toYear : toYear + 1;
  const fyLabel = `FY${String(fiscalYear).slice(-2)}`;

  // Determine quarter (Indian FY: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar)
  let quarter: number | null;
  if (toMonth === 6) quarter = 1;
  else if (toMonth === 9) quarter = 2;
  else if (toMonth === 12) quarter = 3;
  else if (toMonth === 3) quarter = 4;
  else quarter = null;

  // Annual (type "A" or covers 12 months)
  const monthsDiff = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  const isAnnual = monthsDiff >= 11;

  if (isAnnual || resType === "A") {
    return { label: `${fyLabel}`, quarter: 4, fiscalYear, filingType: "annual_report" };
  }

  const label = quarter ? `Q${quarter}${fyLabel}` : `${fromDt.slice(0, 6)}_${toDt.slice(0, 6)}`;
  return { label, quarter, fiscalYear, filingType: "quarterly_result" };
}

// ─────────────────────────────────────────────────────────────
// METRIC EXTRACTION FROM NSE ROW
// ─────────────────────────────────────────────────────────────

function parseNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * Extracts canonical financial metrics from one NSE results row.
 * Unit: ₹ lakhs (converted from raw NSE values).
 */
function extractMetricsFromRow(
  row: NseResultRow,
  entityName: string,
  periodLabel: string,
  accountingBasis: AccountingBasis | null,
): ExtractedMetric[] {
  const metrics: ExtractedMetric[] = [];
  const note = accountingBasis === null
    ? "Accounting basis not determinable from NSE results-comparision API for this record — marked NEEDS_REVIEW. Verify against official XBRL or PDF filing."
    : undefined;

  const add = (metricName: string, value: number | null, statementType: ExtractedMetric["statementType"] = "income_statement") => {
    if (value === null) return;
    metrics.push({
      metricName,
      metricValue: value,
      metricUnit: "lakhs_inr",
      currency: "INR",
      reportingPeriod: periodLabel,
      statementType,
      accountingBasis,
      entityName,
      extractedFrom: "NSE Results Comparison API",
      extractionNotes: note,
    });
  };

  add("revenue", parseNum(row.re_net_sale));
  add("pat", parseNum(row.re_net_profit));
  add("other_income", parseNum(row.re_oth_inc_new));
  add("depreciation", parseNum(row.re_depr_und_exp));
  add("finance_cost", parseNum(row.re_int_new));

  // EBITDA approximation: PBT + tax + depreciation + finance_cost
  // Only compute if all inputs are available
  const pbt = parseNum(row.re_pro_loss_bef_tax);
  const depr = parseNum(row.re_depr_und_exp);
  const fin = parseNum(row.re_int_new);
  if (pbt !== null && depr !== null && fin !== null) {
    add("ebitda", pbt + depr + fin);
    add("ebit", pbt + fin);
  }

  // EPS
  const eps = parseNum(row.re_basic_eps) ?? parseNum(row.re_basic_eps_for_cont_dic_opr);
  if (eps !== null) {
    metrics.push({
      metricName: "eps",
      metricValue: eps,
      metricUnit: "inr",           // EPS is in ₹, not lakhs
      currency: "INR",
      reportingPeriod: periodLabel,
      statementType: "income_statement",
      accountingBasis,
      entityName,
      extractedFrom: "NSE Results Comparison API",
      extractionNotes: note,
    });
  }

  return metrics;
}

// ─────────────────────────────────────────────────────────────
// MAIN FETCH + EXTRACT FUNCTION
// ─────────────────────────────────────────────────────────────

export interface NseResultsIngestionResult {
  success: boolean;
  symbol: string;
  periodsFound: number;
  metrics: ExtractedMetric[];
  periods: Array<{
    label: string;
    quarter: number | null;
    fiscalYear: number;
    filingType: string;
    from: string;
    to: string;
    auditStatus: string;
    accountingBasis: AccountingBasis | null;
    metricCount: number;
  }>;
  error?: string;
  httpStatus?: number | null;
}

export async function fetchAndExtractNseResults(
  symbol: string,
): Promise<NseResultsIngestionResult> {
  const url = `${NSE_RESULTS_URL}${encodeURIComponent(symbol)}`;
  logger.info({ symbol, url }, "Fetching NSE results comparison data");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      return {
        success: false,
        symbol,
        periodsFound: 0,
        metrics: [],
        periods: [],
        error: `HTTP ${resp.status} from NSE results API`,
        httpStatus: resp.status,
      };
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await resp.text();
      return {
        success: false,
        symbol,
        periodsFound: 0,
        metrics: [],
        periods: [],
        error: `NSE results API returned ${contentType} instead of JSON. Session cookie likely required. Preview: ${text.slice(0, 200)}`,
        httpStatus: resp.status,
      };
    }

    const data = (await resp.json()) as { resCmpData?: NseResultRow[]; bankNonBnking?: string };
    const rows: NseResultRow[] = data?.resCmpData ?? [];

    if (rows.length === 0) {
      return {
        success: false,
        symbol,
        periodsFound: 0,
        metrics: [],
        periods: [],
        error: "NSE results API returned empty resCmpData",
        httpStatus: resp.status,
      };
    }

    const allMetrics: ExtractedMetric[] = [];
    const periods: NseResultsIngestionResult["periods"] = [];

    for (const row of rows) {
      const fromDt = String(row.re_from_dt ?? "");
      const toDt = String(row.re_to_dt ?? "");
      if (!fromDt || !toDt) continue;

      const periodInfo = nsePeriodLabel(fromDt, toDt, row.re_res_type);

      // Detect accounting basis from notes text (most reliable signal)
      const notesText = [
        row.re_desc_note_fin ?? "",
        row.re_desc_note_seg ?? "",
      ].join(" ");
      const accountingBasis = detectAccountingBasis(notesText);

      const rowMetrics = extractMetricsFromRow(row, symbol, periodInfo.label, accountingBasis);
      allMetrics.push(...rowMetrics);

      periods.push({
        ...periodInfo,
        from: fromDt,
        to: toDt,
        auditStatus: row.re_res_type === "A" ? "Audited" : "Unaudited",
        accountingBasis,
        metricCount: rowMetrics.length,
      });
    }

    logger.info({ symbol, periods: periods.length, metrics: allMetrics.length }, "NSE results extracted");

    return {
      success: true,
      symbol,
      periodsFound: rows.length,
      metrics: allMetrics,
      periods,
    };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      success: false,
      symbol,
      periodsFound: 0,
      metrics: [],
      periods: [],
      error: isAbort
        ? `NSE results API timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `NSE results API fetch error: ${String(err)}`,
      httpStatus: null,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// NSE SHAREHOLDING API
// ─────────────────────────────────────────────────────────────

const NSE_SHAREHOLDING_URL =
  "https://www.nseindia.com/api/corporate-shareholding-equity?index=equities&symbol=";

export interface ShareholdingEntry {
  category: string;
  subCategory?: string;
  percentage: number;
  shares: number;
  quarter: string;
}

export interface NseShareholdingResult {
  success: boolean;
  symbol: string;
  quarters: string[];
  holdings: ShareholdingEntry[];
  error?: string;
}

export async function fetchNseShareholding(symbol: string): Promise<NseShareholdingResult> {
  const url = `${NSE_SHAREHOLDING_URL}${encodeURIComponent(symbol)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      return { success: false, symbol, quarters: [], holdings: [], error: `HTTP ${resp.status}` };
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      return { success: false, symbol, quarters: [], holdings: [], error: `Non-JSON response: ${ct}` };
    }
    const data = (await resp.json()) as Record<string, unknown>;
    const keys = Object.keys(data);
    logger.info({ symbol, keys, url }, "NSE shareholding response structure");
    return { success: true, symbol, quarters: keys, holdings: [] };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, symbol, quarters: [], holdings: [], error: String(err) };
  }
}
