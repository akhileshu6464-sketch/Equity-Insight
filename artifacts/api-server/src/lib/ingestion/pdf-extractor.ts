/**
 * PDF Text Extraction — using pdftotext (poppler) which is pre-installed in
 * the Replit environment. No npm package, no paid service.
 *
 * Extraction tool: pdftotext (poppler-utils)
 *   - Path:    /nix/store/.../bin/pdftotext  (on PATH as "pdftotext")
 *   - Flags:   -layout  (preserve column/table layout)
 *   - Output:  form-feed (\f) between pages
 *
 * Metadata tool: pdfinfo (poppler-utils)
 *   - Extracts title, author, creator, dates, page count, encryption status
 *
 * Scanned/image-only PDF detection:
 *   - If total extracted text is < MIN_TEXT_CHARS_PER_PAGE * pageCount,
 *     the PDF is likely scanned/image-only.
 *   - Extraction status is set to "scanned" and NO content is stored.
 *   - Never invent or guess text from a scanned PDF.
 *
 * Content format stored in documents.content:
 *   A structured text blob with three sections:
 *     [EXTRACTION_METADATA] JSON header (extraction stats)
 *     [PAGE N / TOTAL] ... page text ...
 *
 * Maximum stored content: MAX_CONTENT_CHARS characters (truncated with marker).
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

/** Characters per page below which a PDF is likely scanned/image-only. */
const MIN_TEXT_CHARS_PER_PAGE = 30;

/** Maximum characters stored in documents.content. */
const MAX_CONTENT_CHARS = 200_000;

/** Timeout for pdftotext/pdfinfo shell calls (ms). */
const SHELL_TIMEOUT_MS = 60_000;

/** Fetch timeout for downloading PDFs from NSE archives (ms). */
const FETCH_TIMEOUT_MS = 45_000;

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
  /** 1-based page number */
  pageNum: number;
  /** Extracted text for this page (may be empty for image-only pages) */
  text: string;
  /** Character count (whitespace stripped) */
  charCount: number;
  /** True if page produced no meaningful text */
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
  /** Page count from pdfinfo (authoritative) */
  pageCount: number;
  fileSizeBytes?: number | null;
  isEncrypted: boolean;
  hasForm: boolean;
  isTagged: boolean;
  pdfVersion?: string | null;
}

export type PdfExtractionStatus =
  | "complete"         // All pages extracted with meaningful text
  | "partial"          // Some pages extracted, some empty/failed
  | "scanned"          // PDF is image-only — no text layer; extraction refused
  | "failed"           // pdftotext failed (corrupt, encrypted, or tool error)
  | "empty"            // PDF has no content pages
  | "truncated";       // Text extracted but truncated at MAX_CONTENT_CHARS

export interface PdfExtractionResult {
  success: boolean;
  extractionStatus: PdfExtractionStatus;
  sourceUrl: string;
  extractedAt: string;        // ISO-8601
  pageCount: number;          // From pdfinfo
  extractedPageCount: number; // Pages with >0 text
  emptyPageCount: number;     // Pages with 0 text
  totalChars: number;
  wasTruncated: boolean;
  pages: PdfPage[];
  metadata: PdfMetadata;
  /** Formatted content block ready to store in documents.content */
  contentBlock: string | null;
  error?: string;
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
      case "title":          meta.title = val; break;
      case "subject":        meta.subject = val; break;
      case "keywords":       meta.keywords = val; break;
      case "author":         meta.author = val; break;
      case "creator":        meta.creator = val; break;
      case "producer":       meta.producer = val; break;
      case "creationdate":   meta.creationDate = val; break;
      case "moddate":        meta.modDate = val; break;
      case "pages":          meta.pageCount = parseInt(val, 10); break;
      case "file size":      meta.fileSizeBytes = parseInt(val, 10); break;
      case "encrypted":      meta.isEncrypted = val.toLowerCase().startsWith("yes"); break;
      case "form":           meta.hasForm = val.toLowerCase() !== "none"; break;
      case "tagged":         meta.isTagged = val.toLowerCase().startsWith("yes"); break;
      case "pdf version":    meta.pdfVersion = val; break;
    }
  }
  return meta;
}

// ─────────────────────────────────────────────────────────────
// CONTENT BLOCK FORMATTER
// ─────────────────────────────────────────────────────────────

/**
 * Formats extracted pages into the structured text block stored in
 * documents.content. Format:
 *
 *   [EXTRACTION_METADATA]
 *   {"extractedAt":"...","pageCount":24,...}
 *
 *   [PAGE 1 / 24]
 *   <text of page 1>
 *
 *   [PAGE 2 / 24]
 *   <text of page 2>
 *   ...
 *   [TRUNCATED — full text exceeded 200,000 characters]
 */
function buildContentBlock(
  pages: PdfPage[],
  metadata: PdfMetadata,
  extractedAt: string,
  sourceUrl: string,
): { block: string; wasTruncated: boolean } {
  const metaJson = JSON.stringify({
    extractedAt,
    sourceUrl,
    pageCount: metadata.pageCount,
    author: metadata.author ?? null,
    creator: metadata.creator ?? null,
    producer: metadata.producer ?? null,
    creationDate: metadata.creationDate ?? null,
    isTagged: metadata.isTagged,
    pdfVersion: metadata.pdfVersion ?? null,
  });

  let block = `[EXTRACTION_METADATA]\n${metaJson}\n\n`;
  const total = pages.length;
  let wasTruncated = false;

  for (const page of pages) {
    const header = `[PAGE ${page.pageNum} / ${total}]\n`;
    const candidate = block + header + page.text + "\n\n";
    if (candidate.length > MAX_CONTENT_CHARS) {
      // Fit as much of this page as possible
      const remaining = MAX_CONTENT_CHARS - block.length - header.length - 60;
      if (remaining > 100) {
        block += header + page.text.slice(0, remaining) + "\n";
      }
      block += "\n[TRUNCATED — full text exceeded 200,000 characters]\n";
      wasTruncated = true;
      break;
    }
    block += header + page.text + "\n\n";
  }

  return { block, wasTruncated };
}

// ─────────────────────────────────────────────────────────────
// CORE EXTRACTION — from a local temp file
// ─────────────────────────────────────────────────────────────

async function extractFromTempFile(
  tmpFilePath: string,
  sourceUrl: string,
): Promise<Omit<PdfExtractionResult, "sourceUrl">> {
  const extractedAt = new Date().toISOString();

  // ── 1. Get metadata via pdfinfo ────────────────────────────
  let rawMeta: Partial<PdfMetadata> = { pageCount: 0, isEncrypted: false, hasForm: false, isTagged: false };
  try {
    const { stdout: infoOut } = await execAsync(
      `pdfinfo "${tmpFilePath}"`,
      { timeout: SHELL_TIMEOUT_MS },
    );
    rawMeta = { ...rawMeta, ...parsePdfInfo(infoOut) };
  } catch (err) {
    logger.warn({ err, tmpFilePath }, "pdfinfo failed — proceeding with pdftotext only");
  }

  // Get actual file size
  try {
    const st = await stat(tmpFilePath);
    rawMeta.fileSizeBytes = st.size;
  } catch { /* ignore */ }

  const metadata: PdfMetadata = {
    pageCount: rawMeta.pageCount ?? 0,
    isEncrypted: rawMeta.isEncrypted ?? false,
    hasForm: rawMeta.hasForm ?? false,
    isTagged: rawMeta.isTagged ?? false,
    title: rawMeta.title ?? null,
    subject: rawMeta.subject ?? null,
    keywords: rawMeta.keywords ?? null,
    author: rawMeta.author ?? null,
    creator: rawMeta.creator ?? null,
    producer: rawMeta.producer ?? null,
    creationDate: rawMeta.creationDate ?? null,
    modDate: rawMeta.modDate ?? null,
    fileSizeBytes: rawMeta.fileSizeBytes ?? null,
    pdfVersion: rawMeta.pdfVersion ?? null,
  };

  // ── 2. Check for encryption ────────────────────────────────
  if (metadata.isEncrypted) {
    return {
      success: false,
      extractionStatus: "failed",
      extractedAt,
      pageCount: metadata.pageCount,
      extractedPageCount: 0,
      emptyPageCount: metadata.pageCount,
      totalChars: 0,
      wasTruncated: false,
      pages: [],
      metadata,
      contentBlock: null,
      error: "PDF is encrypted — pdftotext cannot extract without a password",
    };
  }

  // ── 3. Extract text via pdftotext ──────────────────────────
  let rawText = "";
  let pdfToTextFailed = false;
  try {
    // -layout: preserve whitespace/column layout
    // -enc UTF-8: force UTF-8 output
    // -: write to stdout
    const { stdout } = await execAsync(
      `pdftotext -layout -enc UTF-8 "${tmpFilePath}" -`,
      { timeout: SHELL_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 }, // 20 MB buffer
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
      wasTruncated: false,
      pages: [],
      metadata,
      contentBlock: null,
      error: "pdftotext process failed — PDF may be corrupt or use unsupported encoding",
    };
  }

  // ── 4. Parse pages (separated by form-feed \f) ────────────
  const rawPages = rawText.split("\f");
  // pdftotext often adds a trailing empty page after the last \f
  const trimmedPages = rawPages.map((p) => p.trimEnd());

  const pages: PdfPage[] = [];
  let pageNum = 0;
  for (const raw of trimmedPages) {
    const text = raw.trimStart();
    // Skip trailing empty placeholder pdftotext adds
    if (pageNum >= metadata.pageCount && text.length === 0) continue;
    pageNum++;
    const charCount = text.replace(/\s+/g, "").length;
    pages.push({
      pageNum,
      text,
      charCount,
      isEmpty: charCount === 0,
    });
  }

  // If pdfinfo didn't give us page count, use what pdftotext returned
  if (!metadata.pageCount && pages.length > 0) {
    metadata.pageCount = pages.length;
  }

  // ── 5. Scanned/image-only detection ───────────────────────
  const totalChars = pages.reduce((s, p) => s + p.charCount, 0);
  const extractedPageCount = pages.filter((p) => !p.isEmpty).length;
  const emptyPageCount = pages.filter((p) => p.isEmpty).length;

  const minExpectedChars = MIN_TEXT_CHARS_PER_PAGE * Math.max(metadata.pageCount, 1);
  const isScanned = totalChars < minExpectedChars;

  if (isScanned) {
    logger.warn(
      { sourceUrl, totalChars, pageCount: metadata.pageCount, minExpectedChars },
      "PDF appears to be scanned/image-only — extraction refused",
    );
    return {
      success: false,
      extractionStatus: "scanned",
      extractedAt,
      pageCount: metadata.pageCount,
      extractedPageCount: 0,
      emptyPageCount: pages.length,
      totalChars,
      wasTruncated: false,
      pages,
      metadata,
      contentBlock: null,
      error: `PDF appears to be scanned/image-only: only ${totalChars} text characters found across ${metadata.pageCount} pages (threshold: ${minExpectedChars}). No text extracted — OCR would be required.`,
    };
  }

  // ── 6. Build content block ─────────────────────────────────
  const { block, wasTruncated } = buildContentBlock(pages, metadata, extractedAt, sourceUrl);

  let extractionStatus: PdfExtractionStatus;
  if (wasTruncated) {
    extractionStatus = "truncated";
  } else if (emptyPageCount > 0 && extractedPageCount > 0) {
    extractionStatus = "partial";
  } else if (extractedPageCount === 0) {
    extractionStatus = "empty";
  } else {
    extractionStatus = "complete";
  }

  logger.info(
    {
      sourceUrl,
      pageCount: metadata.pageCount,
      extractedPageCount,
      emptyPageCount,
      totalChars,
      wasTruncated,
      extractionStatus,
    },
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
    wasTruncated,
    pages,
    metadata,
    contentBlock: block,
  };
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API — extract from URL (downloads to temp, cleans up)
// ─────────────────────────────────────────────────────────────

export async function extractPdfFromUrl(url: string): Promise<PdfExtractionResult> {
  logger.info({ url }, "Starting PDF extraction from URL");

  // ── Fetch PDF ──────────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let pdfBuffer: Buffer;
  let contentType = "";

  try {
    const resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timer);

    contentType = resp.headers.get("content-type") ?? "";
    if (!resp.ok) {
      return buildFetchError(url, `HTTP ${resp.status} from ${url}`);
    }
    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      // Try anyway — some servers return wrong content-type
      logger.warn({ url, contentType }, "Unexpected content-type for PDF URL — attempting extraction anyway");
    }
    const arrayBuf = await resp.arrayBuffer();
    pdfBuffer = Buffer.from(arrayBuf);
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return buildFetchError(
      url,
      isAbort ? `Fetch timed out after ${FETCH_TIMEOUT_MS}ms` : `Fetch error: ${String(err)}`,
    );
  }

  // ── Write to temp file ─────────────────────────────────────
  const tmpFile = path.join(tmpdir(), `pdf_extract_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await writeFile(tmpFile, pdfBuffer);
  } catch (err) {
    return buildFetchError(url, `Failed to write temp file: ${String(err)}`);
  }

  // ── Extract ────────────────────────────────────────────────
  try {
    const result = await extractFromTempFile(tmpFile, url);
    return { ...result, sourceUrl: url };
  } finally {
    // Always clean up the temp file
    await unlink(tmpFile).catch((e) => {
      logger.warn({ tmpFile, err: e }, "Failed to delete temp PDF file");
    });
  }
}

/** Extract from an already-downloaded buffer (no fetch). */
export async function extractPdfFromBuffer(
  buffer: Buffer,
  sourceUrl: string,
): Promise<PdfExtractionResult> {
  const tmpFile = path.join(tmpdir(), `pdf_extract_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await writeFile(tmpFile, buffer);
    const result = await extractFromTempFile(tmpFile, sourceUrl);
    return { ...result, sourceUrl };
  } finally {
    await unlink(tmpFile).catch((e) => {
      logger.warn({ tmpFile, err: e }, "Failed to delete temp PDF file");
    });
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
    wasTruncated: false,
    pages: [],
    metadata: emptyMeta,
    contentBlock: null,
    error,
  };
}

/**
 * Maps PdfExtractionStatus to the documents.text_extraction_status enum values.
 * Only "complete", "partial", "truncated" → "complete" (text was extracted).
 * "scanned", "failed", "empty" → "failed".
 */
export function toDbExtractionStatus(
  status: PdfExtractionStatus,
): "complete" | "failed" | "pending" {
  switch (status) {
    case "complete":
    case "partial":
    case "truncated":
      return "complete";
    case "scanned":
    case "failed":
    case "empty":
      return "failed";
    default:
      return "failed";
  }
}
