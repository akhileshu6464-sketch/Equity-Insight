/**
 * Content Extractor — parses XBRL, HTML, and plain text into structured data.
 *
 * Priority:
 *   1. XBRL (highest fidelity — structured, machine-readable)
 *   2. HTML (semi-structured — table extraction)
 *   3. PDF text (lowest fidelity — pattern matching only)
 *
 * CRITICAL RULE: Accounting basis (STANDALONE / CONSOLIDATED) must be
 * explicitly present in the document header or table title before it
 * can be assigned.  If the source is ambiguous, accountingBasis must
 * be null and dataQualityStatus must be NEEDS_REVIEW.
 * Never infer, guess, or default the accounting basis.
 */

import type { ExtractionResult, ExtractedMetric } from "./types.js";
import type { AccountingBasis } from "../data-sources.js";
import { FINANCIAL_METRIC_NAMES } from "../data-sources.js";
import { logger } from "../logger.js";

// ─────────────────────────────────────────────────────────────
// ACCOUNTING BASIS DETECTION
// ─────────────────────────────────────────────────────────────

/**
 * Attempts to determine accounting basis from document text.
 * Returns null if the basis cannot be determined unambiguously.
 * Never defaults or infers.
 */
export function detectAccountingBasis(text: string): AccountingBasis | null {
  const lower = text.toLowerCase();

  // Look for explicit basis statements near the document header
  const standalonePatterns = [
    /\bstandalone\b/,
    /\bunconsolidated\b/,
    /statement of standalone/i,
    /standalone financial statement/i,
    /standalone results/i,
    /\(standalone\)/i,
  ];
  const consolidatedPatterns = [
    /\bconsolidated\b/,
    /consolidated financial statement/i,
    /consolidated results/i,
    /\(consolidated\)/i,
  ];

  const hasStandalone = standalonePatterns.some((p) => p.test(lower));
  const hasConsolidated = consolidatedPatterns.some((p) => p.test(lower));

  if (hasStandalone && !hasConsolidated) return "STANDALONE";
  if (hasConsolidated && !hasStandalone) return "CONSOLIDATED";
  // Both present or neither — cannot determine unambiguously
  return null;
}

// ─────────────────────────────────────────────────────────────
// METRIC NAME NORMALISATION
// Maps various label forms found in filings to canonical names.
// ─────────────────────────────────────────────────────────────

const METRIC_LABEL_MAP: Record<string, (typeof FINANCIAL_METRIC_NAMES)[number]> = {
  // Revenue / turnover
  "revenue from operations": "revenue",
  "net revenue": "revenue",
  "total revenue": "revenue",
  "total income from operations": "revenue",
  "net sales": "revenue",
  turnover: "revenue",
  // EBITDA
  ebitda: "ebitda",
  "operating profit": "ebitda",
  "earnings before interest tax depreciation and amortisation": "ebitda",
  // EBIT
  ebit: "ebit",
  "earnings before interest and tax": "ebit",
  "profit before interest and tax": "ebit",
  // PAT
  pat: "pat",
  "profit after tax": "pat",
  "profit for the period": "pat",
  "profit for the year": "pat",
  "net profit": "pat",
  "net income": "pat",
  // EPS
  eps: "eps",
  "earnings per share": "eps",
  "basic eps": "eps",
  "diluted eps": "eps",
  // Other income
  "other income": "other_income",
  "other operating income": "other_income",
  // Finance cost
  "finance costs": "finance_cost",
  "finance cost": "finance_cost",
  "interest expense": "finance_cost",
  "interest and finance charges": "finance_cost",
  // Balance sheet
  "total assets": "total_assets",
  "shareholders equity": "net_worth",
  "total equity": "net_worth",
  "net worth": "net_worth",
  "stockholders equity": "net_worth",
  cash: "cash",
  "cash and cash equivalents": "cash",
  "cash and bank balances": "cash",
  "total debt": "total_debt",
  borrowings: "total_debt",
  "total borrowings": "total_debt",
  "net debt": "net_debt",
  "trade receivables": "receivables",
  receivables: "receivables",
  debtors: "receivables",
  inventories: "inventory",
  inventory: "inventory",
  "trade payables": "payables",
  payables: "payables",
  creditors: "payables",
  "working capital": "working_capital",
  "depreciation and amortisation": "depreciation",
  depreciation: "depreciation",
  "minority interest": "minority_interest",
  "non controlling interest": "minority_interest",
  // Cash flow
  "net cash from operating activities": "operating_cash_flow",
  "cash from operations": "operating_cash_flow",
  "operating cash flow": "operating_cash_flow",
  "net cash used in investing activities": "investing_cash_flow",
  "net cash from investing activities": "investing_cash_flow",
  "net cash used in financing activities": "financing_cash_flow",
  "net cash from financing activities": "financing_cash_flow",
  "capital expenditure": "capex",
  capex: "capex",
  "purchase of fixed assets": "capex",
  "free cash flow": "free_cash_flow",
};

export function normaliseMetricLabel(
  label: string,
): (typeof FINANCIAL_METRIC_NAMES)[number] | null {
  const key = label.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  return METRIC_LABEL_MAP[key] ?? null;
}

// ─────────────────────────────────────────────────────────────
// XBRL EXTRACTION
// XBRL (eXtensible Business Reporting Language) provides
// machine-readable structured financial data.
// Indian companies file XBRL with NSE/BSE for quarterly results
// and annual reports.
// ─────────────────────────────────────────────────────────────

/**
 * Extracts structured financial metrics from XBRL XML.
 *
 * XBRL uses namespace-qualified tags to identify financial concepts.
 * Indian XBRL follows the MCA taxonomy (Ministry of Corporate Affairs).
 * NSE quarterly results use an NSE-specific XBRL schema.
 *
 * This implementation handles the common MCA/NSE XBRL patterns.
 * An industrial-strength parser would use a full XBRL processor.
 */
export function extractFromXbrl(xbrlXml: string, entityName: string): ExtractionResult {
  logger.info({ entityName, bytes: xbrlXml.length }, "Extracting from XBRL");

  try {
    // Detect accounting basis from XBRL context labels
    const accountingBasis = detectAccountingBasis(xbrlXml);

    // Extract numeric values from XBRL elements.
    // XBRL tags contain the concept name as the tag and the value as content.
    // Pattern: <ns:ConceptName contextRef="..." decimals="..." unitRef="...">123456</ns:ConceptName>
    const xbrlValuePattern =
      /<(?:[a-zA-Z0-9_]+:)?([A-Za-z][A-Za-z0-9_]*)([^>]*)>\s*([-\d,.]+)\s*<\/(?:[a-zA-Z0-9_]+:)?[A-Za-z][A-Za-z0-9_]*>/g;

    const metrics: ExtractedMetric[] = [];
    const seenConcepts = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = xbrlValuePattern.exec(xbrlXml)) !== null) {
      const conceptName = match[1];
      const attrs = match[2];
      const rawValue = match[3].replace(/,/g, "");
      const value = parseFloat(rawValue);

      if (isNaN(value)) continue;
      if (seenConcepts.has(conceptName)) continue; // take first occurrence (current period)
      seenConcepts.add(conceptName);

      // Map XBRL concept names to canonical metric names
      const humanLabel = conceptName
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLowerCase();
      const canonicalName = normaliseMetricLabel(humanLabel);
      if (!canonicalName) continue;

      // Attempt to extract the reporting period from contextRef
      const contextMatch = attrs.match(/contextRef="([^"]+)"/);
      const contextRef = contextMatch?.[1] ?? "";

      // Attempt to extract decimals (INR in lakhs vs crores)
      const decimalsMatch = attrs.match(/decimals="([^"]+)"/);
      const decimals = decimalsMatch ? parseInt(decimalsMatch[1], 10) : 0;
      const unit = decimals <= -7 ? "crores_inr" : decimals <= -5 ? "lakhs_inr" : "inr";

      // Determine statement type from concept name
      let statementType: ExtractedMetric["statementType"] = "income_statement";
      if (/asset|liabilit|equity|borrow|inventori|receivable|payable/i.test(conceptName)) {
        statementType = "balance_sheet";
      } else if (/cash|capex|capital.expend/i.test(conceptName)) {
        statementType = "cash_flow";
      }

      metrics.push({
        metricName: canonicalName,
        metricValue: value,
        metricUnit: unit,
        currency: "INR",
        reportingPeriod: contextRef || "UNKNOWN",
        statementType,
        accountingBasis,
        entityName,
        extractedFrom: "XBRL",
        extractionNotes: accountingBasis === null
          ? "Accounting basis could not be determined unambiguously from XBRL context — marked NEEDS_REVIEW"
          : undefined,
      });
    }

    if (metrics.length === 0) {
      return {
        success: false,
        reason: "XBRL_UNSUPPORTED",
        detail:
          "No recognisable financial metrics found in XBRL document. The schema may use a namespace or taxonomy version that this extractor does not support.",
      };
    }

    logger.info({ entityName, metricsFound: metrics.length }, "XBRL extraction complete");
    return {
      success: true,
      documentType: "xbrl",
      extractedMetrics: metrics,
      managementStatements: [],
      extractionNotes: `Extracted ${metrics.length} metrics from XBRL. Basis: ${accountingBasis ?? "UNCLEAR"}.`,
    };
  } catch (err) {
    return {
      success: false,
      reason: "PARSING_FAILED",
      detail: `XBRL parsing error: ${String(err)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// HTML EXTRACTION
// Extracts financial tables and management statements from HTML.
// ─────────────────────────────────────────────────────────────

/**
 * Extracts financial data and management statements from HTML content.
 * Works on exchange filing pages, investor presentation HTML versions,
 * and quarterly result pages.
 */
export function extractFromHtml(
  html: string,
  entityName: string,
  reportingPeriod: string,
): ExtractionResult {
  logger.info({ entityName, reportingPeriod, bytes: html.length }, "Extracting from HTML");

  try {
    const accountingBasis = detectAccountingBasis(html);

    // Remove script and style blocks
    const cleanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");

    // Extract all table rows
    const tableRows: Array<[string, string]> = [];
    const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trPattern.exec(cleanHtml)) !== null) {
      const cells = trMatch[1].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [];
      const texts = cells.map((c) =>
        c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim(),
      );
      if (texts.length >= 2 && texts[0]) {
        const label = texts[0];
        const value = texts[1].replace(/,/g, "");
        if (label && value && !isNaN(parseFloat(value))) {
          tableRows.push([label, value]);
        }
      }
    }

    const metrics: ExtractedMetric[] = [];
    for (const [label, rawValue] of tableRows) {
      const canonicalName = normaliseMetricLabel(label);
      if (!canonicalName) continue;
      const value = parseFloat(rawValue);
      if (isNaN(value)) continue;

      let statementType: ExtractedMetric["statementType"] = "income_statement";
      if (/asset|liabilit|equity|borrow/i.test(label)) statementType = "balance_sheet";
      else if (/cash|capex/i.test(label)) statementType = "cash_flow";

      metrics.push({
        metricName: canonicalName,
        metricValue: value,
        metricUnit: "crores_inr",
        currency: "INR",
        reportingPeriod,
        statementType,
        accountingBasis,
        entityName,
        extractedFrom: "HTML",
        extractionNotes: accountingBasis === null
          ? "Accounting basis ambiguous in HTML source — marked NEEDS_REVIEW"
          : undefined,
      });
    }

    // Extract management statements (paragraphs containing guidance keywords)
    const guidanceKeywords = /guidance|target|expect|outlook|plan|project|forecast|aim|intend/i;
    const paragraphPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    const managementStatements: Array<{ statement: string; speaker?: string; topic: string; isVerbatim: boolean }> = [];

    let pMatch: RegExpExecArray | null;
    while ((pMatch = paragraphPattern.exec(cleanHtml)) !== null) {
      const text = pMatch[1].replace(/<[^>]+>/g, "").trim();
      if (text.length > 50 && guidanceKeywords.test(text)) {
        managementStatements.push({
          statement: text.slice(0, 2000),
          topic: "guidance",
          isVerbatim: false,
        });
      }
    }

    const rawText = cleanHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    logger.info({ entityName, metricsFound: metrics.length, statements: managementStatements.length }, "HTML extraction complete");
    return {
      success: true,
      documentType: "html",
      extractedMetrics: metrics,
      managementStatements,
      rawText: rawText.slice(0, 50_000),
      extractionNotes: `HTML extraction: ${metrics.length} metrics, ${managementStatements.length} management statements. Basis: ${accountingBasis ?? "UNCLEAR"}.`,
    };
  } catch (err) {
    return {
      success: false,
      reason: "PARSING_FAILED",
      detail: `HTML extraction error: ${String(err)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// TEXT EXTRACTION (from PDF text or plain text)
// ─────────────────────────────────────────────────────────────

/**
 * Extracts financial metrics from plain text (e.g., from a PDF).
 * Uses pattern matching against labelled financial table rows.
 * Less reliable than XBRL or HTML table extraction.
 */
export function extractFromText(
  text: string,
  entityName: string,
  reportingPeriod: string,
): ExtractionResult {
  logger.info({ entityName, reportingPeriod, bytes: text.length }, "Extracting from text");

  try {
    const accountingBasis = detectAccountingBasis(text);

    // Pattern: "Label ... 123,456" or "Label 123456"
    const metricPattern = /([A-Za-z \/\-]+?)\s{2,}([\d,]+(?:\.\d+)?)/g;
    const metrics: ExtractedMetric[] = [];
    let m: RegExpExecArray | null;

    while ((m = metricPattern.exec(text)) !== null) {
      const label = m[1].trim();
      const rawValue = m[2].replace(/,/g, "");
      const value = parseFloat(rawValue);
      if (isNaN(value) || value === 0) continue;

      const canonicalName = normaliseMetricLabel(label);
      if (!canonicalName) continue;

      let statementType: ExtractedMetric["statementType"] = "income_statement";
      if (/asset|liabilit|equity|borrow/i.test(label)) statementType = "balance_sheet";
      else if (/cash|capex/i.test(label)) statementType = "cash_flow";

      metrics.push({
        metricName: canonicalName,
        metricValue: value,
        metricUnit: "crores_inr",
        currency: "INR",
        reportingPeriod,
        statementType,
        accountingBasis,
        entityName,
        extractedFrom: "PDF/TEXT",
        extractionNotes: accountingBasis === null
          ? "Accounting basis ambiguous — marked NEEDS_REVIEW. Verify against original document."
          : "Extracted via text pattern matching — verify against original document.",
      });
    }

    logger.info({ entityName, metricsFound: metrics.length }, "Text extraction complete");
    return {
      success: true,
      documentType: "text",
      extractedMetrics: metrics,
      managementStatements: [],
      rawText: text.slice(0, 50_000),
      extractionNotes: `Text extraction: ${metrics.length} metrics. Basis: ${accountingBasis ?? "UNCLEAR"}. Text-based extraction is lower confidence than XBRL.`,
    };
  } catch (err) {
    return {
      success: false,
      reason: "PARSING_FAILED",
      detail: `Text extraction error: ${String(err)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// SMART EXTRACTION ROUTER
// Picks the right extraction method based on content type.
// ─────────────────────────────────────────────────────────────

export function extractFromContent(
  content: string,
  contentType: string,
  entityName: string,
  reportingPeriod: string,
): ExtractionResult {
  if (contentType.includes("xml") || contentType.includes("xbrl")) {
    return extractFromXbrl(content, entityName);
  }
  if (contentType.includes("html") || contentType.includes("text/html")) {
    return extractFromHtml(content, entityName, reportingPeriod);
  }
  if (contentType.includes("pdf")) {
    // PDF text extraction is handled by pdf-extractor.ts (uses pdftotext/poppler).
    // The pipeline route POST /api/ingestion/extract-pdf accepts a URL and runs the
    // full extraction → storage flow. This synchronous path cannot handle PDFs
    // (they need async shell calls and a URL); callers should use extractPdfFromUrl().
    return {
      success: false,
      reason: "PARSING_FAILED",
      detail: "PDF content requires async extraction via extractPdfFromUrl() in pdf-extractor.ts (uses pdftotext/poppler). Use POST /api/ingestion/extract-pdf with the document URL.",
    };
  }
  // Fall back to text extraction
  return extractFromText(content, entityName, reportingPeriod);
}
