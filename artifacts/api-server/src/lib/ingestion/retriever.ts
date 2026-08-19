/**
 * Document Retriever — fetches the official filing document from a URL.
 *
 * Handles:
 *   - HTML pages (exchange filing pages, investor presentations)
 *   - XBRL XML files (structured financial data)
 *   - PDF files (annual reports, quarterly results)
 *
 * This module is responsible ONLY for retrieval.  It does not parse
 * or interpret the content — that is handled by extractor.ts.
 *
 * All failures are returned as typed RetrievalResult errors.
 * Nothing is silently swallowed.
 */

import type { RetrievalResult, IngestionErrorReason } from "./types.js";
import { logger } from "../logger.js";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MB

const RETRIEVAL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/xml, text/html, application/pdf, application/json, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─────────────────────────────────────────────────────────────
// ERROR CLASSIFICATION
// ─────────────────────────────────────────────────────────────

function classifyFetchError(err: unknown, url: string): { reason: IngestionErrorReason; detail: string } {
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return {
        reason: "SOURCE_UNREACHABLE",
        detail: `Request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms. The server did not respond within the timeout window.`,
      };
    }
    if (err.message.includes("ECONNREFUSED") || err.message.includes("ENOTFOUND")) {
      return {
        reason: "NETWORK_BLOCKED",
        detail: `Cannot connect to ${url}: ${err.message}. The host may be blocking cloud datacenter IP ranges.`,
      };
    }
  }
  return {
    reason: "UNKNOWN",
    detail: `Unexpected error fetching ${url}: ${String(err)}`,
  };
}

function classifyHttpStatus(status: number, url: string): { reason: IngestionErrorReason; detail: string } {
  if (status === 403 || status === 401) {
    return {
      reason: "AUTH_REQUIRED",
      detail: `HTTP ${status} from ${url}. Access denied — authentication or IP allowlisting required.`,
    };
  }
  if (status === 404) {
    return {
      reason: "NOT_FOUND",
      detail: `HTTP 404 from ${url}. Document not found — the URL may be incorrect or the filing may have been removed.`,
    };
  }
  if (status === 429) {
    return {
      reason: "RATE_LIMITED",
      detail: `HTTP 429 from ${url}. Rate limited by the server.`,
    };
  }
  if (status >= 500) {
    return {
      reason: "SOURCE_UNREACHABLE",
      detail: `HTTP ${status} from ${url}. Server error on the exchange/company side.`,
    };
  }
  return {
    reason: "UNKNOWN",
    detail: `HTTP ${status} from ${url}.`,
  };
}

// ─────────────────────────────────────────────────────────────
// CORE RETRIEVAL
// ─────────────────────────────────────────────────────────────

/**
 * Retrieves any document from a URL.
 * Returns the raw content as a string (for HTML/XML) or base64 (for PDF).
 */
export async function retrieveDocument(url: string): Promise<RetrievalResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  logger.info({ url }, "Retrieving document");

  try {
    const resp = await fetch(url, {
      headers: RETRIEVAL_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const { reason, detail } = classifyHttpStatus(resp.status, url);
      logger.warn({ url, status: resp.status, reason }, "Document retrieval failed");
      return { success: false, url, reason, httpStatus: resp.status, detail };
    }

    const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = parseInt(resp.headers.get("content-length") ?? "0", 10);

    if (contentLength > MAX_RESPONSE_BYTES) {
      return {
        success: false,
        url,
        reason: "PARSING_FAILED",
        httpStatus: resp.status,
        detail: `Document is too large (${contentLength} bytes > ${MAX_RESPONSE_BYTES} bytes limit).`,
      };
    }

    let content: string;

    if (contentType.includes("pdf")) {
      // PDFs are returned as base64 for downstream text extraction
      const buffer = await resp.arrayBuffer();
      content = Buffer.from(buffer).toString("base64");
      logger.info({ url, contentType, bytes: buffer.byteLength }, "PDF retrieved");
    } else {
      // HTML, XML, JSON — return as UTF-8 string
      content = await resp.text();
      logger.info({ url, contentType, bytes: content.length }, "Document retrieved");
    }

    return {
      success: true,
      url,
      contentType,
      content,
      contentLength: content.length,
      retrievedAt: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timer);
    const { reason, detail } = classifyFetchError(err, url);
    logger.error({ url, reason, err }, "Document retrieval network error");
    return { success: false, url, reason, httpStatus: null, detail };
  }
}

// ─────────────────────────────────────────────────────────────
// XBRL RETRIEVAL
// XBRL documents are XML-based structured financial data.
// When available, they are preferred over PDF/HTML extraction.
// ─────────────────────────────────────────────────────────────

/**
 * Retrieves an XBRL document from its URL.
 * XBRL documents are XML text — returned as a string.
 *
 * NSE provides XBRL for financial results via:
 *   https://archives.nseindia.com/corporate/xbrl/{filename}.zip
 *
 * Known limitation: archives.nseindia.com is not reachable from
 * cloud server environments (HTTP 000 — network-level block).
 */
export async function retrieveXbrl(url: string): Promise<RetrievalResult> {
  logger.info({ url }, "Retrieving XBRL document");
  // XBRL is XML — use the same retriever
  const result = await retrieveDocument(url);
  if (result.success && !result.contentType.includes("xml")) {
    // If we got something that isn't XML, it's not a valid XBRL file
    return {
      success: false,
      url,
      reason: "PARSING_FAILED",
      httpStatus: null,
      detail: `Expected XML/XBRL but received ${result.contentType}. The URL may not point to an XBRL document.`,
    };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// PDF TEXT EXTRACTION
// Extracts readable text from a base64-encoded PDF.
// Note: Scanned PDFs (images) cannot be extracted without OCR.
// ─────────────────────────────────────────────────────────────

/**
 * Extracts text content from a base64-encoded PDF.
 *
 * Current implementation: returns the raw PDF bytes for downstream
 * processing.  A production implementation would use a PDF parsing
 * library (pdf-parse, pdfjs-dist) or an OCR service.
 *
 * Returns the extracted text or a failure if the PDF is scanned.
 */
export async function extractTextFromPdfBase64(base64Pdf: string): Promise<
  | { success: true; text: string; pageCount?: number; isScanned: false }
  | { success: false; reason: IngestionErrorReason; detail: string }
> {
  try {
    // Detect whether this is a scanned PDF by checking for embedded text.
    // A PDF with very few text characters relative to its size is likely scanned.
    const pdfBytes = Buffer.from(base64Pdf, "base64");

    // Rudimentary text detection: look for BT (Begin Text) markers in the raw PDF
    const pdfStr = pdfBytes.toString("latin1");
    const btCount = (pdfStr.match(/BT\b/g) ?? []).length;
    const etCount = (pdfStr.match(/\bET\b/g) ?? []).length;

    if (btCount === 0 || etCount === 0) {
      return {
        success: false,
        reason: "SCANNED_PDF",
        detail:
          "PDF does not appear to contain embedded text (no BT/ET markers found). This is likely a scanned document. OCR is required for text extraction from scanned PDFs.",
      };
    }

    // Extract raw text between BT...ET blocks (simplified; production would use pdf-parse)
    const textBlocks: string[] = [];
    const btMatches = pdfStr.matchAll(/BT\b([\s\S]*?)\bET\b/g);
    for (const match of btMatches) {
      // Extract string literals from PDF text blocks (Tj, TJ operators)
      const block = match[1];
      const strings = block.match(/\(([^)]*)\)\s*Tj|\[([^\]]*)\]\s*TJ/g) ?? [];
      for (const s of strings) {
        const text = s.replace(/^\(|\)\s*Tj$/g, "").replace(/^\[|\]\s*TJ$/g, "");
        textBlocks.push(text.replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " "));
      }
    }

    const fullText = textBlocks.join(" ").replace(/\s+/g, " ").trim();
    if (fullText.length < 100) {
      return {
        success: false,
        reason: "SCANNED_PDF",
        detail: `PDF appears to be scanned or image-based — extracted only ${fullText.length} characters of text. OCR required.`,
      };
    }

    return { success: true, text: fullText, isScanned: false };
  } catch (err) {
    return {
      success: false,
      reason: "PARSING_FAILED",
      detail: `PDF text extraction error: ${String(err)}`,
    };
  }
}
