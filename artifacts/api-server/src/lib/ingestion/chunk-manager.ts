/**
 * Document Chunk Manager
 *
 * Splits extracted PDF pages into searchable chunks and stores them in the
 * `document_chunks` table.  The parent `documents` row stores only a compact
 * metadata header + preview; ALL page text lives here — nothing is discarded.
 *
 * Chunking rules
 * ──────────────
 *  chunk_index = 0  — metadata header (page_start = page_end = 0)
 *  chunk_index ≥ 1  — content pages, following these grouping rules:
 *
 *   • NORMAL page  (300 – MAX_CHUNK_CHARS chars)  → one page per chunk
 *   • SMALL  page  (< 300 chars)                  → group up to MAX_SMALL_PAGES
 *                                                   consecutive small pages
 *   • LARGE  page  (> MAX_CHUNK_CHARS chars)       → split into sub-chunks of
 *                                                   TARGET_CHUNK_CHARS each;
 *                                                   chunk_label notes "part N/M"
 *
 * Retrieval helpers
 * ─────────────────
 *  getDocumentChunks(documentId, opts)   — ordered fetch, optional page-range
 *  searchDocumentChunks(companyId, q)    — ILIKE keyword search across company
 *
 * Storage
 * ───────
 *  Chunks are batch-inserted (BATCH_SIZE at a time) via the Supabase REST API.
 *  Each batch is independent; a batch failure is logged but does not abort
 *  subsequent batches.
 */

import { logger } from "../logger.js";
import type { PdfPage } from "./pdf-extractor.js";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

/** Pages with fewer non-whitespace chars than this are "small" and get grouped. */
const SMALL_PAGE_THRESHOLD = 300;

/** Maximum non-whitespace chars before a page is split into sub-chunks. */
const MAX_CHUNK_CHARS = 8_000;

/** Target sub-chunk size when splitting a large page. */
const TARGET_CHUNK_CHARS = 4_000;

/** Maximum consecutive small pages to group into one chunk. */
const MAX_SMALL_PAGES = 3;

/** How many chunks to insert per REST API call. */
const BATCH_SIZE = 20;

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface DocumentChunk {
  /** 0-based sequential index within the document. 0 = metadata header. */
  chunkIndex: number;
  /** First PDF page in this chunk (1-based). 0 for the metadata header. */
  pageStart: number;
  /** Last PDF page in this chunk (1-based). 0 for the metadata header. */
  pageEnd: number;
  /** Full extracted text — never truncated. */
  content: string;
  /** Non-whitespace character count. */
  charCount: number;
  /** Human-readable label, e.g. "Page 3", "Pages 4–5", "Page 7 (part 2/3)". */
  chunkLabel: string;
}

export interface ChunkStorageResult {
  totalChunks: number;
  storedChunks: number;
  failedChunks: number;
  errors: string[];
}

export interface ChunkSearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  chunkLabel: string;
  charCount: number;
  /** Full content of the matching chunk. */
  content: string;
  /** Matched company ID. */
  companyId: string;
}

// ─────────────────────────────────────────────────────────────
// CHUNKING LOGIC
// ─────────────────────────────────────────────────────────────

/**
 * Splits a large page's text into TARGET_CHUNK_CHARS sub-chunks.
 * Tries to break at newlines (\n) to avoid cutting mid-sentence.
 */
function splitLargePage(text: string): string[] {
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_CHUNK_CHARS) {
    let cutAt = TARGET_CHUNK_CHARS;
    // Try to cut at a newline near the target
    const nlIdx = remaining.lastIndexOf("\n", TARGET_CHUNK_CHARS + 200);
    if (nlIdx > TARGET_CHUNK_CHARS - 500 && nlIdx !== -1) {
      cutAt = nlIdx + 1;
    }
    parts.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  if (remaining.trim().length > 0) parts.push(remaining);
  return parts;
}

/**
 * Converts an array of PDF pages into DocumentChunks.
 * chunk_index 0 is always the metadata header.
 * Pages start at chunk_index 1.
 */
export function chunkPages(
  pages: PdfPage[],
  metadataHeader: string,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];

  // ── Chunk 0: metadata header ───────────────────────────────
  chunks.push({
    chunkIndex: 0,
    pageStart: 0,
    pageEnd: 0,
    content: metadataHeader,
    charCount: metadataHeader.replace(/\s+/g, "").length,
    chunkLabel: "Metadata",
  });

  // ── Content chunks ─────────────────────────────────────────
  let chunkIdx = 1;
  let i = 0;

  while (i < pages.length) {
    const page = pages[i];
    const text = page.text;
    const textCharCount = text.replace(/\s+/g, "").length;

    // ── Large page: split into sub-chunks ─────────────────────
    if (textCharCount > MAX_CHUNK_CHARS) {
      const parts = splitLargePage(text);
      const totalParts = parts.length;
      for (let p = 0; p < parts.length; p++) {
        const partText = parts[p];
        chunks.push({
          chunkIndex: chunkIdx++,
          pageStart: page.pageNum,
          pageEnd: page.pageNum,
          content: partText,
          charCount: partText.replace(/\s+/g, "").length,
          chunkLabel:
            totalParts === 1
              ? `Page ${page.pageNum}`
              : `Page ${page.pageNum} (part ${p + 1}/${totalParts})`,
        });
      }
      i++;
      continue;
    }

    // ── Small page: try to group with next small pages ─────────
    if (textCharCount < SMALL_PAGE_THRESHOLD && !page.isEmpty) {
      const groupPages: PdfPage[] = [page];
      let j = i + 1;
      while (
        j < pages.length &&
        groupPages.length < MAX_SMALL_PAGES &&
        pages[j].charCount < SMALL_PAGE_THRESHOLD
      ) {
        groupPages.push(pages[j]);
        j++;
      }

      if (groupPages.length > 1) {
        const combined = groupPages
          .map((p) => `[Page ${p.pageNum}]\n${p.text}`)
          .join("\n\n");
        const first = groupPages[0].pageNum;
        const last = groupPages[groupPages.length - 1].pageNum;
        chunks.push({
          chunkIndex: chunkIdx++,
          pageStart: first,
          pageEnd: last,
          content: combined,
          charCount: combined.replace(/\s+/g, "").length,
          chunkLabel: `Pages ${first}–${last}`,
        });
        i = j;
        continue;
      }
    }

    // ── Empty page: store as minimal chunk (preserves page ref) ─
    if (page.isEmpty) {
      chunks.push({
        chunkIndex: chunkIdx++,
        pageStart: page.pageNum,
        pageEnd: page.pageNum,
        content: `[Page ${page.pageNum} — no extractable text]`,
        charCount: 0,
        chunkLabel: `Page ${page.pageNum} (empty)`,
      });
      i++;
      continue;
    }

    // ── Normal page: one chunk ─────────────────────────────────
    chunks.push({
      chunkIndex: chunkIdx++,
      pageStart: page.pageNum,
      pageEnd: page.pageNum,
      content: text,
      charCount: textCharCount,
      chunkLabel: `Page ${page.pageNum}`,
    });
    i++;
  }

  return chunks;
}

// ─────────────────────────────────────────────────────────────
// COMPACT DOCUMENT PREVIEW (stored in documents.content)
// ─────────────────────────────────────────────────────────────

const PREVIEW_MAX_CHARS = 5_000;
const PREVIEW_PAGES = 3;

/**
 * Builds the compact summary stored in documents.content.
 * Contains: metadata JSON header + first PREVIEW_PAGES page texts (truncated
 * to PREVIEW_MAX_CHARS total) + a reference to the chunks table.
 */
export function buildDocumentPreview(
  metadataHeader: string,
  pages: PdfPage[],
  chunkCount: number,
): string {
  let preview = metadataHeader + "\n\n";
  const totalPages = pages.length;

  for (let p = 0; p < Math.min(PREVIEW_PAGES, pages.length); p++) {
    const page = pages[p];
    const header = `[PAGE ${page.pageNum} / ${totalPages} — preview]\n`;
    const candidate = preview + header + page.text + "\n\n";
    if (candidate.length > PREVIEW_MAX_CHARS) {
      const remaining = PREVIEW_MAX_CHARS - preview.length - header.length - 4;
      if (remaining > 100) {
        preview += header + page.text.slice(0, remaining) + "…\n";
      }
      break;
    }
    preview += header + page.text + "\n\n";
  }

  preview +=
    `[CHUNKED — ${chunkCount} chunks (${totalPages} pages) stored in ` +
    `document_chunks table. Full text is preserved. ` +
    `Use GET /api/ingestion/chunks/{documentId} to retrieve specific pages ` +
    `or POST /api/ingestion/search-chunks to search for evidence.]\n`;

  return preview;
}

// ─────────────────────────────────────────────────────────────
// SUPABASE HELPERS
// ─────────────────────────────────────────────────────────────

function getSupabase(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return { url, key };
}

async function supabasePost(path: string, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const { url, key } = getSupabase();
  const resp = await fetch(`${url}/rest/v1${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",        // we don't need IDs back for chunks
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

async function supabaseGet<T>(path: string): Promise<T[]> {
  const { url, key } = getSupabase();
  const resp = await fetch(`${url}/rest/v1${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`Supabase GET ${path}: HTTP ${resp.status}`);
  return resp.json() as Promise<T[]>;
}

// ─────────────────────────────────────────────────────────────
// STORE CHUNKS
// ─────────────────────────────────────────────────────────────

/**
 * Batch-inserts all chunks into `document_chunks`.
 * Each batch is independent — a failed batch is logged but does not abort others.
 * Returns storage statistics.
 */
export async function storeDocumentChunks(
  documentId: string,
  companyId: string,
  chunks: DocumentChunk[],
): Promise<ChunkStorageResult> {
  const result: ChunkStorageResult = {
    totalChunks: chunks.length,
    storedChunks: 0,
    failedChunks: 0,
    errors: [],
  };

  // ── First, delete any existing chunks for this document ────
  // Allows re-extraction to replace stale chunks cleanly.
  try {
    const { url, key } = getSupabase();
    const delResp = await fetch(
      `${url}/rest/v1/document_chunks?document_id=eq.${documentId}`,
      {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      },
    );
    if (!delResp.ok) {
      const t = await delResp.text();
      logger.warn({ documentId, status: delResp.status, body: t }, "Old chunk deletion failed — inserting anyway");
    }
  } catch (err) {
    logger.warn({ err, documentId }, "Old chunk deletion error — inserting anyway");
  }

  // ── Batch insert ───────────────────────────────────────────
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const rows = batch.map((c) => ({
      document_id: documentId,
      company_id: companyId,
      chunk_index: c.chunkIndex,
      page_start: c.pageStart,
      page_end: c.pageEnd,
      char_count: c.charCount,
      content: c.content,
      chunk_label: c.chunkLabel,
    }));

    try {
      const { ok, status, text } = await supabasePost("/document_chunks", rows);
      if (ok) {
        result.storedChunks += batch.length;
      } else {
        result.failedChunks += batch.length;
        const errMsg = `Batch ${Math.floor(i / BATCH_SIZE) + 1}: HTTP ${status} — ${text.slice(0, 200)}`;
        result.errors.push(errMsg);
        logger.error({ documentId, errMsg }, "Chunk batch insert failed");
      }
    } catch (err) {
      result.failedChunks += batch.length;
      const errMsg = `Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${String(err)}`;
      result.errors.push(errMsg);
      logger.error({ err, documentId }, "Chunk batch insert threw");
    }
  }

  logger.info(
    { documentId, total: result.totalChunks, stored: result.storedChunks, failed: result.failedChunks },
    "Chunk storage complete",
  );

  return result;
}

// ─────────────────────────────────────────────────────────────
// RETRIEVE CHUNKS
// ─────────────────────────────────────────────────────────────

export interface GetChunksOptions {
  /** Return only chunks whose page_start >= pageFrom */
  pageFrom?: number;
  /** Return only chunks whose page_end <= pageTo */
  pageTo?: number;
  /** Specific chunk indexes to fetch */
  chunkIndexes?: number[];
  /** Max chunks to return (default 50) */
  limit?: number;
  /** Whether to include the metadata header chunk (chunk_index = 0). Default: false */
  includeMetadata?: boolean;
}

/**
 * Retrieves ordered chunks for a document.
 * Use pageFrom/pageTo to retrieve a page range (e.g. pages 5–10).
 */
export async function getDocumentChunks(
  documentId: string,
  opts: GetChunksOptions = {},
): Promise<DocumentChunk[]> {
  const { pageFrom, pageTo, chunkIndexes, limit = 50, includeMetadata = false } = opts;

  const params = new URLSearchParams({
    document_id: `eq.${documentId}`,
    order: "chunk_index.asc",
    limit: String(Math.min(limit, 500)),
    select: "chunk_index,page_start,page_end,char_count,content,chunk_label",
  });

  if (!includeMetadata) {
    params.set("chunk_index", "gt.0");
  }
  if (pageFrom !== undefined) {
    params.set("page_start", `gte.${pageFrom}`);
  }
  if (pageTo !== undefined) {
    params.set("page_end", `lte.${pageTo}`);
  }
  if (chunkIndexes && chunkIndexes.length > 0) {
    params.set("chunk_index", `in.(${chunkIndexes.join(",")})`);
  }

  const rows = await supabaseGet<{
    chunk_index: number;
    page_start: number;
    page_end: number;
    char_count: number;
    content: string;
    chunk_label: string;
  }>(`/document_chunks?${params.toString()}`);

  return rows.map((r) => ({
    chunkIndex: r.chunk_index,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    charCount: r.char_count,
    content: r.content,
    chunkLabel: r.chunk_label,
  }));
}

// ─────────────────────────────────────────────────────────────
// KEYWORD SEARCH ACROSS CHUNKS
// ─────────────────────────────────────────────────────────────

/**
 * Searches document chunks for a company using case-insensitive keyword matching.
 * Returns up to `limit` chunks ordered by chunk_index (page order preserved).
 *
 * For future full-text ranking, the document_chunks_fts_idx GIN index supports
 * to_tsvector('english', content) queries — upgrade this function to use
 * ts_rank when more precise relevance is needed.
 */
export async function searchDocumentChunks(
  companyId: string,
  query: string,
  limit = 10,
): Promise<ChunkSearchResult[]> {
  if (!query || query.trim().length < 2) return [];

  // Escape special characters for ILIKE
  const safeQuery = query.trim().replace(/[%_\\]/g, "\\$&");

  const params = new URLSearchParams({
    company_id: `eq.${companyId}`,
    content: `ilike.*${safeQuery}*`,
    chunk_index: "gt.0",   // skip metadata headers
    order: "chunk_index.asc",
    limit: String(Math.min(limit, 100)),
    select: "id,document_id,chunk_index,page_start,page_end,char_count,content,chunk_label",
  });

  const rows = await supabaseGet<{
    id: string;
    document_id: string;
    chunk_index: number;
    page_start: number;
    page_end: number;
    char_count: number;
    content: string;
    chunk_label: string;
  }>(`/document_chunks?${params.toString()}`);

  // Enrich with document titles (batch fetch, deduplicated by document_id)
  const docIds = [...new Set(rows.map((r) => r.document_id))];
  const titleMap: Record<string, string> = {};

  if (docIds.length > 0) {
    try {
      const docRows = await supabaseGet<{ id: string; title: string }>(
        `/documents?id=in.(${docIds.map((id) => `"${id}"`).join(",")})&select=id,title`,
      );
      for (const d of docRows) titleMap[d.id] = d.title;
    } catch {
      // Title enrichment is best-effort
    }
  }

  return rows.map((r) => ({
    chunkId: r.id,
    documentId: r.document_id,
    documentTitle: titleMap[r.document_id] ?? "(unknown)",
    chunkIndex: r.chunk_index,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    chunkLabel: r.chunk_label,
    charCount: r.char_count,
    content: r.content,
    companyId,
  }));
}
