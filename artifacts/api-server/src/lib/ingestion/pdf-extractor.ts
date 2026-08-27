/**
 * PDF Text Extraction — using pdftotext (poppler) which is pre-installed in
 * the Replit environment. No npm package, no paid service.
 *
 * Extraction tool:   pdftotext (poppler-utils)  — -layout -enc UTF-8
 * Metadata tool:     pdfinfo  (poppler-utils)
 *
 * Output contract
 * ───────────────
 * extractPdfFromUrl() returns:
 *   - ALL extracted pages, NEVER truncated
 *   - metadataHeader: compact JSON string used as chunk 0
 *   - pageCount, extractedPageCount, emptyPageCount, totalChars
 *   - extractionStatus: "complete" | "partial" | "scanned" | "failed" | "empty"
 *
 * The caller (extract-pdf route) is responsible for:
 *   1. Chunking pages via chunk-manager.ts → buildDocumentPreview + chunkPages
 *   2. Storing chunks via storeDocumentChunks()
 *   3. Writing the compact preview to documents.content
 *
 * Scanned/image-only detection
 * ─────────────────────────────
 * If total non-whitespace chars < MIN_TEXT_CHARS_PER_PAGE × pageCount the PDF
 * is assumed to be image-only.  extractionStatus is set to "scanned", pages
 * array is returned (all isEmpty=true), and NO content is stored.
 * Text is NEVER invented or guessed.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { logger } from "../logger.js";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

/** Chars/page below which PDF is likely scanned/image-only. */
const MIN_TEXT_CHARS_PER_PAGE = 30;

/** Timeout for pdftotext/pdfinfo shell calls (ms). */
const SHELL_TIMEOUT_MS = 60_000;

/** Timeout for fetching a PDF from NSE/BSE archives (ms). */
const FETCH_TIMEOUT_MS = 45_000;

/** Max stdout buffer for pdftotext — handles very large annual reports. */
const PDFTOTEXT_MAX_BUFFER = 50 * 1024 * 1024; // 50 MB

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/pdf,*/*;q=0.9",
  Referer: "https://www.nseindia.com",
};

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface PdfPage {
  /** 1-based page number. */
  pageNum: number;
  /** Full extracted text for this page — never truncated. */
  text: string;
  /** Non-whitespace character count. */
  charCount: number;
  /** True when the page produced no meaningful text (image-only page). */
  isEmpty: boolean;
}

export interface PdfMetadata {
  title?: string | null;
  subject?: string | null;
  keywords?: string | null;
  author?: string | null;
  creator?: string | null;
  producer?: string | null;
  creationDate?: string | null;
  modDate?: string | null;
  /** Authoritative page count from pdfinfo. */
  pageCount: number;
  fileSizeBytes?: number | null;
  isEncrypted: boolean;
  hasForm: boolean;
  isTagged: boolean;
  pdfVersion?: string | null;
}

export type PdfExtractionStatus =
  | "complete"   // All pages extracted with meaningful text
  | "partial"    // Some pages extracted; some empty/image-only pages
  | "scanned"    // Entire PDF is image-only — no text layer; not stored
  | "failed"     // pdftotext process failed (corrupt/encrypted/tool error)
  | "empty";     // PDF has pages but none produced any text

export interface PdfExtractionResult {
  success: boolean;
  extractionStatus: PdfExtractionStatus;
  sourceUrl: string;
  extractedAt: string;           // ISO-8601
  pageCount: number;             // From pdfinfo (authoritative)
  extractedPageCount: number;    // Pages with charCount > 0
  emptyPageCount: number;        // Pages with charCount = 0
  totalChars: number;            // Sum of all page charCounts
  /**
   * All extracted pages — complete, never truncated.
   * Use chunk-manager.ts to split and store these.
   */
  pages: PdfPage[];
  metadata: PdfMetadata;
  /**
   * Compact JSON string to use as chunk_index=0 in document_chunks.
   * Contains source URL, extraction timestamp, pdfinfo metadata.
   * Null when extraction failed before metadata could be gathered.
   */
  metadataHeader: string | null;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// METADATA HEADER BUILDER
// ─────────────────────────────────────────────────────────────

/**
 * Builds the compact metadata JSON block used as:
 *   - chunk 0 content in document_chunks
 *   - the header section of documents.content (preview)
 *
 * Format:
 *   [EXTRACTION_METADATA]
 *   {"extractedAt":"...","sourceUrl":"...","pageCount":24,...}
 */
export function buildMetadataHeader(
  metadata: PdfMetadata,
  extractedAt: string,
  sourceUrl: string,
): string {
  const json = JSON.stringify({
    extractedAt,
    sourceUrl,
    pageCount: metadata.pageCount,
    fileSizeBytes: metadata.fileSizeBytes ?? null,
    author: metadata.author ?? null,
    creator: metadata.creator ?? null,
    producer: metadata.producer ?? null,
    creationDate: metadata.creationDate ?? null,
    modDate: metadata.modDate ?? null,
    isEncrypted: metadata.isEncrypted,
    hasForm: metadata.hasForm,
    isTagged: metadata.isTagged,
    pdfVersion: metadata.pdfVersion ?? null,
  });
  return `[EXTRACTION_METADATA]\n${json}`;
}

// ─────────────────────────────────────────────────────────────
// PDFINFO PARSER
// ─────────────────────────────────────────────────────────────

function parsePdfInfo(output: string): Partial<PdfMetadata> {
  const meta: Partial<PdfMetadata> = {};
  for (const line of output.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (!val || val === "(none)") continue;
    switch (key) {
      case "title":        meta.title = val; break;
      case "subject":      meta.subject = val; break;
      case "keywords":     meta.keywords = val; break;
      case "author":       meta.author = val; break;
      case "creator":      meta.creator = val; break;
      case "producer":     meta.producer = val; break;
      case "creationdate": meta.creationDate = val; break;
      case "moddate":      meta.modDate = val; break;
      case "pages":        meta.pageCount = parseInt(val, 10); break;
      case "file size":    meta.fileSizeBytes = parseInt(val, 10); break;
      case "encrypted":    meta.isEncrypted = val.toLowerCase().startsWith("yes"); break;
      case "form":         meta.hasForm = val.toLowerCase() !== "none"; break;
      case "tagged":       meta.isTagged = val.toLowerCase().startsWith("yes"); break;
      case "pdf version":  meta.pdfVersion = val; break;
    }
  }
  return meta;
}

// ─────────────────────────────────────────────────────────────
// CORE EXTRACTION (from a local temp file)
// ─────────────────────────────────────────────────────────────

async function extractFromTempFile(
  tmpFilePath: string,
  sourceUrl: string,
): Promise<Omit<PdfExtractionResult, "sourceUrl">> {
  const extractedAt = new Date().toISOString();

  // ── 1. pdfinfo — metadata ──────────────────────────────────
  let rawMeta: Partial<PdfMetadata> = {
    pageCount: 0, isEncrypted: false, hasForm: false, isTagged: false,
  };
  try {
    const { stdout } = await execAsync(
      `pdfinfo "${tmpFilePath}"`,
      { timeout: SHELL_TIMEOUT_MS },
    );
    rawMeta = { ...rawMeta, ...parsePdfInfo(stdout) };
  } catch (err) {
    logger.warn({ err, tmpFilePath }, "pdfinfo failed — proceeding with pdftotext only");
  }

  try {
    const st = await stat(tmpFilePath);
    rawMeta.fileSizeBytes = st.size;
  } catch { /* ignore */ }

  const metadata: PdfMetadata = {
    pageCount:     rawMeta.pageCount  ?? 0,
    isEncrypted:   rawMeta.isEncrypted ?? false,
    hasForm:       rawMeta.hasForm    ?? false,
    isTagged:      rawMeta.isTagged   ?? false,
    title:         rawMeta.title      ?? null,
    subject:       rawMeta.subject    ?? null,
    keywords:      rawMeta.keywords   ?? null,
    author:        rawMeta.author     ?? null,
    creator:       rawMeta.creator    ?? null,
    producer:      rawMeta.producer   ?? null,
    creationDate:  rawMeta.creationDate ?? null,
    modDate:       rawMeta.modDate    ?? null,
    fileSizeBytes: rawMeta.fileSizeBytes ?? null,
    pdfVersion:    rawMeta.pdfVersion ?? null,
  };

  const metadataHeader = buildMetadataHeader(metadata, extractedAt, sourceUrl);

  // ── 2. Encryption guard ────────────────────────────────────
  if (metadata.isEncrypted) {
    return {
      success: false,
      extractionStatus: "failed",
      extractedAt,
      pageCount: metadata.pageCount,
      extractedPageCount: 0,
      emptyPageCount: metadata.pageCount,
      totalChars: 0,
      pages: [],
      metadata,
      metadataHeader,
      error: "PDF is encrypted — pdftotext cannot extract without a password",
    };
  }

  // ── 3. pdftotext — full extraction, no buffer cap on pages ─
  let rawText = "";
  let pdfToTextFailed = false;
  try {
    const { stdout } = await execAsync(
      `pdftotext -layout -enc UTF-8 "${tmpFilePath}" -`,
      { timeout: SHELL_TIMEOUT_MS, maxBuffer: PDFTOTEXT_MAX_BUFFER },
    );
    rawText = stdout;
  } catch (err) {
    logger.error({ err, tmpFilePath }, "pdftotext failed");
    pdfToTextFailed = true;
  }

  if (pdfToTextFailed) {
    return {
      success: false,
      extractionStatus: "failed",
      extractedAt,
      pageCount: metadata.pageCount,
      extractedPageCount: 0,
      emptyPageCount: metadata.pageCount,
      totalChars: 0,
      pages: [],
      metadata,
      metadataHeader,
      error: "pdftotext process failed — PDF may be corrupt or use unsupported encoding",
    };
  }

  // ── 4. Parse pages — form-feed (\f) separates pages ───────
  const rawPages = rawText.split("\f");
  const pages: PdfPage[] = [];
  let pageNum = 0;

  for (const raw of rawPages) {
    const text = raw.trimStart().trimEnd();
    // Skip the trailing empty entry pdftotext adds after the last \f
    if (pageNum >= metadata.pageCount && text.length === 0) continue;
    pageNum++;
    const charCount = text.replace(/\s+/g, "").length;
    pages.push({ pageNum, text, charCount, isEmpty: charCount === 0 });
  }

  // If pdfinfo didn't give us pageCount, use pdftotext's output
  if (!metadata.pageCount && pages.length > 0) {
    metadata.pageCount = pages.length;
  }

  // ── 5. Scanned/image-only detection ───────────────────────
  const totalChars = pages.reduce((s, p) => s + p.charCount, 0);
  const extractedPageCount = pages.filter((p) => !p.isEmpty).length;
  const emptyPageCount = pages.filter((p) => p.isEmpty).length;
  const minExpected = MIN_TEXT_CHARS_PER_PAGE * Math.max(metadata.pageCount, 1);

  if (totalChars < minExpected) {
    logger.warn(
      { sourceUrl, totalChars, pageCount: metadata.pageCount, minExpected },
      "PDF appears scanned/image-only — extraction refused",
    );
    return {
      success: false,
      extractionStatus: "scanned",
      extractedAt,
      pageCount: metadata.pageCount,
      extractedPageCount: 0,
      emptyPageCount: pages.length,
      totalChars,
      pages,   // returned so caller can see page count even for scanned PDFs
      metadata,
      metadataHeader,
      error:
        `PDF appears to be scanned/image-only: only ${totalChars} text chars ` +
        `found across ${metadata.pageCount} pages (threshold: ${minExpected}). ` +
        `No text stored — OCR would be required.`,
    };
  }

  // ── 6. Determine extraction status ────────────────────────
  let extractionStatus: PdfExtractionStatus;
  if (extractedPageCount === 0) {
    extractionStatus = "empty";
  } else if (emptyPageCount > 0) {
    extractionStatus = "partial";
  } else {
    extractionStatus = "complete";
  }

  logger.info(
    { sourceUrl, pageCount: metadata.pageCount, extractedPageCount, emptyPageCount, totalChars, extractionStatus },
    "PDF extraction complete",
  );

  return {
    success: true,
    extractionStatus,
    extractedAt,
    pageCount: metadata.pageCount,
    extractedPageCount,
    emptyPageCount,
    totalChars,
    pages,
    metadata,
    metadataHeader,
  };
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

/** Download a PDF from a URL, extract all pages, return complete result. */
export async function extractPdfFromUrl(url: string): Promise<PdfExtractionResult> {
  logger.info({ url }, "Starting PDF extraction from URL");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let pdfBuffer: Buffer;

  try {
    const resp = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) return buildFetchError(url, `HTTP ${resp.status} fetching ${url}`);

    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("pdf") && !ct.includes("octet-stream")) {
      logger.warn({ url, ct }, "Unexpected content-type — attempting extraction anyway");
    }
    pdfBuffer = Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return buildFetchError(
      url,
      isAbort ? `Fetch timed out after ${FETCH_TIMEOUT_MS}ms` : `Fetch error: ${String(err)}`,
    );
  }

  const tmpFile = path.join(
    tmpdir(),
    `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
  );
  try {
    await writeFile(tmpFile, pdfBuffer);
  } catch (err) {
    return buildFetchError(url, `Failed to write temp file: ${String(err)}`);
  }

  try {
    const result = await extractFromTempFile(tmpFile, url);
    return { ...result, sourceUrl: url };
  } finally {
    await unlink(tmpFile).catch((e) => logger.warn({ tmpFile, err: e }, "Temp file cleanup failed"));
  }
}

/** Extract from an already-downloaded buffer. */
export async function extractPdfFromBuffer(
  buffer: Buffer,
  sourceUrl: string,
): Promise<PdfExtractionResult> {
  const tmpFile = path.join(
    tmpdir(),
    `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
  );
  try {
    await writeFile(tmpFile, buffer);
    const result = await extractFromTempFile(tmpFile, sourceUrl);
    return { ...result, sourceUrl };
  } finally {
    await unlink(tmpFile).catch((e) => logger.warn({ tmpFile, err: e }, "Temp file cleanup failed"));
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function buildFetchError(sourceUrl: string, error: string): PdfExtractionResult {
  const emptyMeta: PdfMetadata = {
    pageCount: 0, isEncrypted: false, hasForm: false, isTagged: false,
  };
  return {
    success: false,
    extractionStatus: "failed",
    sourceUrl,
    extractedAt: new Date().toISOString(),
    pageCount: 0,
    extractedPageCount: 0,
    emptyPageCount: 0,
    totalChars: 0,
    pages: [],
    metadata: emptyMeta,
    metadataHeader: null,
    error,
  };
}

/**
 * Maps PdfExtractionStatus → documents.text_extraction_status enum values.
 *   complete / partial → "complete"  (text was extracted and chunked)
 *   scanned / failed / empty → "failed"
 */
export function toDbExtractionStatus(
  status: PdfExtractionStatus,
): "complete" | "failed" | "pending" {
  switch (status) {
    case "complete":
    case "partial":
      return "complete";
    case "scanned":
    case "failed":
    case "empty":
      return "failed";
    default:
      return "failed";
  }
}
