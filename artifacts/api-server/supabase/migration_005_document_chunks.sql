-- Migration 005: document_chunks — page-level chunk storage for extracted PDFs
--
-- Run in Supabase SQL Editor AFTER migration_004_ingestion_queue.sql.
-- Project: wnfjdajjhdbuvnpqzfjk  (ap-south-1)
--
-- Purpose:
--   Every extracted PDF page (or sub-page section) is stored as an individual
--   row in this table.  The parent documents row holds only:
--     - metadata (source, extraction status, page count)
--     - a compact preview (~first 3 pages) in `content`
--   This table holds the COMPLETE extracted text — no page is ever discarded.
--
-- Chunk anatomy:
--   chunk_index = 0  → extraction metadata JSON header (page_start = page_end = 0)
--   chunk_index ≥ 1  → one or more consecutive PDF pages
--
-- Chunking rules (enforced by the application, not the DB):
--   - Normal pages (300-8000 chars): one page per chunk.
--   - Small pages (< 300 chars): grouped with adjacent small pages (≤ 3 per chunk).
--   - Large pages (> 8000 chars): split into 4000-char sub-chunks; label notes the split.
--
-- Retrieval:
--   GET /api/ingestion/chunks/:documentId            — all chunks, ordered
--   GET /api/ingestion/chunks/:documentId?pages=1-5  — page range
--   POST /api/ingestion/search-chunks               — ILIKE keyword search across company
--
-- RLS:
--   Row-level security is enabled (matching the rest of the schema) but no
--   policies are created here; the service-role key used by the API bypasses RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DOCUMENT_CHUNKS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.document_chunks (
  id            uuid primary key default gen_random_uuid(),

  -- Parent document (cascade-delete removes all chunks when document is deleted)
  document_id   uuid not null
    references public.documents(id) on delete cascade,

  -- Denormalised for fast per-company queries without a join
  company_id    uuid not null
    references public.companies(id) on delete cascade,

  -- Ordering within the document (0-based).
  -- chunk_index = 0 is always the metadata header chunk.
  chunk_index   integer not null
    check (chunk_index >= 0),

  -- Page range (1-based PDF page numbers).
  -- Both = 0 for the metadata header chunk (chunk_index = 0).
  page_start    integer not null
    check (page_start >= 0),
  page_end      integer not null
    check (page_end >= 0),

  -- Character count of the content field (stored for fast size queries)
  char_count    integer not null default 0
    check (char_count >= 0),

  -- Complete extracted text — no length limit, never truncated at the DB level.
  content       text not null,

  -- Human-readable label: "Page 1", "Pages 2–3", "Page 5 (part 1/3)", "Metadata"
  chunk_label   text,

  created_at    timestamptz not null default now(),

  -- A document may have each chunk_index exactly once
  constraint document_chunks_doc_chunk_unique unique (document_id, chunk_index)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- Primary access pattern: fetch all chunks for a document in order
create index if not exists document_chunks_document_order_idx
  on public.document_chunks (document_id, chunk_index);

-- Per-company search (used by searchDocumentChunks)
create index if not exists document_chunks_company_idx
  on public.document_chunks (company_id);

-- Page-range retrieval (used by getDocumentChunks with page filter)
create index if not exists document_chunks_pages_idx
  on public.document_chunks (document_id, page_start, page_end);

-- Full-text search using PostgreSQL's built-in tsvector (English stemming)
-- Supports future ts_rank-based relevance ranking without a paid vector extension.
create index if not exists document_chunks_fts_idx
  on public.document_chunks
  using gin (to_tsvector('english', content));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ROW-LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.document_chunks enable row level security;
-- No policies — service-role key used by API bypasses RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. COMMENTS
-- ─────────────────────────────────────────────────────────────────────────────

comment on table public.document_chunks is
  'Page-level text chunks from extracted PDF documents. Never truncated. '
  'Parent documents row holds metadata and a short preview only. '
  'Supports full-text search via the document_chunks_fts_idx GIN index.';

comment on column public.document_chunks.chunk_index is
  '0-based position within the document. Index 0 is always the metadata header.';

comment on column public.document_chunks.page_start is
  '1-based first PDF page included in this chunk. 0 for the metadata header chunk.';

comment on column public.document_chunks.page_end is
  '1-based last PDF page included in this chunk. 0 for the metadata header chunk.';

comment on column public.document_chunks.content is
  'Complete extracted text for this chunk. No truncation applied.';
