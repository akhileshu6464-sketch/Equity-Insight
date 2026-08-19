-- StockLens — Migration 004: Ingestion Queue
-- Extends the data_quality_status enum with two new values and
-- creates the filing_queue table that tracks every filing from
-- discovery through to storage.
--
-- Run after migration_003_data_source_architecture.sql.
-- Safe to rerun: ADD VALUE IF NOT EXISTS; CREATE TABLE IF NOT EXISTS.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Run this file outside of BEGIN/COMMIT in the Supabase SQL editor.

-- ─────────────────────────────────────────────────────────────
-- 1. EXTEND data_quality_status ENUM
--    Two new values required by the ingestion pipeline spec:
--      FAILED_EXTRACTION — source was reached but data could not
--        be parsed or extracted (e.g., scanned PDF, corrupted XBRL)
--      NEEDS_REVIEW      — extraction produced a value but the
--        basis, period, or unit is ambiguous and requires a human
--        or secondary-source confirmation before marking VERIFIED
-- ─────────────────────────────────────────────────────────────
alter type public.data_quality_status add value if not exists 'FAILED_EXTRACTION';
alter type public.data_quality_status add value if not exists 'NEEDS_REVIEW';

-- ─────────────────────────────────────────────────────────────
-- 2. FILING QUEUE
--    Central tracking table for the ingestion pipeline.
--    One row per discovered filing.  Tracks the full lifecycle:
--      discovered → queued → retrieving → retrieved → processing
--      → processed (or failed at any stage)
--
--    Every filing that enters the system must pass through this
--    table.  No financial metric or document can be stored without
--    a corresponding filing_queue entry as the lineage anchor.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.filing_queue (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,

  -- Filing identity
  filing_type           text not null
    check (filing_type in (
      'annual_report',
      'quarterly_result',
      'half_yearly_result',
      'nine_month_result',
      'shareholding_pattern',
      'investor_presentation',
      'concall_transcript',
      'corporate_announcement',
      'board_meeting',
      'corporate_action',
      'insider_trading',
      'related_party_transactions',
      'corporate_governance',
      'brsr',
      'xbrl_financial',
      'other_filing'
    )),

  -- Period context
  filing_period         text,
  fiscal_year           smallint,
  quarter               smallint check (quarter between 1 and 4),
  filing_date           date,

  -- Source
  source_exchange       text not null check (source_exchange in ('NSE', 'BSE', 'COMPANY', 'SEBI', 'MCA')),
  source_tier           smallint not null check (source_tier between 1 and 4),
  discovery_method      text not null
    check (discovery_method in ('nse_rss', 'bse_api', 'nse_api', 'manual', 'xbrl_feed')),
  discovered_at         timestamptz not null default now(),

  -- URLs
  filing_url            text,
  document_url          text,
  xbrl_url              text,
  xbrl_available        boolean not null default false,

  -- Filing metadata
  filing_title          text,
  filing_description    text,
  exchange_filing_id    text,

  -- Retrieval lifecycle
  retrieval_status      text not null default 'pending'
    check (retrieval_status in ('pending', 'retrieving', 'complete', 'failed', 'blocked')),
  retrieval_error       text,
  retrieval_error_code  text,
  retrieval_attempts    smallint not null default 0,
  last_retrieval_at     timestamptz,

  -- Processing lifecycle
  processing_status     text not null default 'unprocessed'
    check (processing_status in ('unprocessed', 'queued', 'processing', 'processed', 'failed')),
  processing_error      text,
  processed_at          timestamptz,

  -- Outputs (populated after successful processing)
  document_id           uuid references public.documents(id) on delete set null,
  metrics_stored        smallint not null default 0,
  data_quality_status   public.data_quality_status not null default 'UNVERIFIED',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Prevent duplicate discovery of the same filing from the same exchange
create unique index if not exists filing_queue_dedup_idx
  on public.filing_queue (company_id, source_exchange, filing_type, filing_period)
  where filing_period is not null;

-- Fast lookup by company and filing type
create index if not exists filing_queue_company_type_idx
  on public.filing_queue (company_id, filing_type, filing_date desc);

-- Processing queue: find pending/queued items
create index if not exists filing_queue_pending_idx
  on public.filing_queue (retrieval_status, processing_status)
  where retrieval_status in ('pending', 'blocked')
     or processing_status in ('unprocessed', 'queued');

alter table public.filing_queue enable row level security;
