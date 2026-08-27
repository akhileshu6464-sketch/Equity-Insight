-- StockLens — Migration 003: Data Source Architecture
-- Adds the full data ingestion foundation:
--   company master data enhancements, source registry, financial metrics
--   with full lineage, management commentary, shareholding, and data
--   quality conflict tracking.
--
-- Run after migration_002_research_checks.sql.
-- Safe to rerun: uses IF NOT EXISTS and ADD COLUMN IF NOT EXISTS throughout.
-- Does NOT modify or remove any existing table, column, constraint,
-- index, RLS policy, or seed data from schema.sql, migration_001,
-- or migration_002.

-- ─────────────────────────────────────────────────────────────
-- 1. NEW ENUM TYPES
--    Each uses the DO block pattern required by this project
--    (CREATE TYPE IF NOT EXISTS is invalid PostgreSQL syntax).
-- ─────────────────────────────────────────────────────────────

-- Accounting basis: the most critical integrity constraint.
-- Every financial figure must carry one of these two values.
-- Mixing them in a single calculation is prohibited.
do $$ begin
  create type public.accounting_basis as enum ('STANDALONE', 'CONSOLIDATED');
exception when duplicate_object then null;
end $$;

-- Statement the metric belongs to.
do $$ begin
  create type public.statement_type as enum (
    'income_statement',
    'balance_sheet',
    'cash_flow',
    'notes'
  );
exception when duplicate_object then null;
end $$;

-- Period granularity.
do $$ begin
  create type public.period_type as enum (
    'annual',
    'quarterly',
    'half_yearly',
    'ltm'
  );
exception when duplicate_object then null;
end $$;

-- Data quality status for every imported data point.
do $$ begin
  create type public.data_quality_status as enum (
    'VERIFIED',
    'UNVERIFIED',
    'CONFLICTING',
    'MISSING'
  );
exception when duplicate_object then null;
end $$;

-- Ownership/legal type of a company record.
do $$ begin
  create type public.company_type as enum (
    'listed_company',
    'holding_company',
    'subsidiary',
    'associate',
    'jv'
  );
exception when duplicate_object then null;
end $$;

-- Conflict resolution status for the data_quality table.
do $$ begin
  create type public.conflict_resolution_status as enum (
    'pending',
    'resolved',
    'ignored'
  );
exception when duplicate_object then null;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. ENHANCE public.companies
--    Adds the company master data fields required by the spec.
--    The existing columns (name, ticker, exchange, sector,
--    industry, short_description) are unchanged.
--    Sub-industry is already stored in company_profiles.
-- ─────────────────────────────────────────────────────────────
alter table public.companies
  add column if not exists legal_name           text,
  add column if not exists isin                 text,
  add column if not exists company_type         public.company_type not null default 'listed_company',
  add column if not exists parent_company_id    uuid references public.companies(id) on delete set null,
  add column if not exists reporting_currency   text not null default 'INR',
  add column if not exists fiscal_year_end      text not null default 'March',
  add column if not exists is_active            boolean not null default true;

-- Unique index on ISIN when provided (ISINs are globally unique).
create unique index if not exists companies_isin_idx
  on public.companies (isin)
  where isin is not null;

-- Index on parent_company_id for hierarchy traversal.
create index if not exists companies_parent_idx
  on public.companies (parent_company_id)
  where parent_company_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 3. SOURCE REGISTRY
--    Source hierarchy table. The AI must prefer lower tier
--    numbers (higher trust) when sources conflict.
--
--    Tier 1: Primary filings (annual reports, exchange filings,
--            auditor reports, regulatory filings)
--    Tier 2: Company communications (investor presentations,
--            official announcements, concall transcripts)
--    Tier 3: Reliable secondary (financial data providers,
--            reputable financial news)
--    Tier 4: Other secondary sources
-- ─────────────────────────────────────────────────────────────
create table if not exists public.source_registry (
  id            uuid primary key default gen_random_uuid(),
  source_name   text not null unique,
  source_type   text not null,
  tier          smallint not null check (tier between 1 and 4),
  tier_label    text not null,
  base_url      text,
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists source_registry_tier_idx
  on public.source_registry (tier);

alter table public.source_registry enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 4. FINANCIAL METRICS (full lineage model)
--    One row per metric per period per accounting basis per entity.
--    Every row carries its complete provenance:
--      entity, metric, value, unit, currency, period, basis,
--      source, source URL, source date, extraction date.
--
--    The existing financial_data table (prototype, named columns)
--    is left unchanged. This table is the production model.
--
--    CRITICAL: accounting_basis is NOT NULL and has no default.
--    A financial figure without a basis cannot be inserted.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.financial_metrics (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,

  -- Entity (may differ from the listed company for subsidiary data)
  entity_name           text not null,
  entity_ticker         text,

  -- Metric identity
  metric_name           text not null,
  metric_value          numeric not null,
  metric_unit           text not null default 'crores_inr',
  currency              text not null default 'INR',

  -- Time period
  reporting_period      text not null,
  fiscal_year           smallint,
  period_type           public.period_type not null,
  quarter               smallint check (quarter between 1 and 4),

  -- Statement
  statement_type        public.statement_type not null,

  -- CRITICAL: accounting basis is mandatory on every row
  accounting_basis      public.accounting_basis not null,

  -- Source provenance (full lineage)
  source_name           text not null,
  source_tier           smallint not null check (source_tier between 1 and 4),
  source_registry_id    uuid references public.source_registry(id) on delete set null,
  source_document_id    uuid references public.documents(id) on delete set null,
  source_url            text,
  source_date           date,
  extraction_date       timestamptz not null default now(),

  -- Data quality
  data_quality_status   public.data_quality_status not null default 'UNVERIFIED',
  is_demo               boolean not null default false,
  quality_notes         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Lookup by company + metric + basis + period (the most common query pattern)
create index if not exists financial_metrics_lookup_idx
  on public.financial_metrics (company_id, metric_name, accounting_basis, reporting_period);

-- All metrics for a company in a given period and basis
create index if not exists financial_metrics_period_idx
  on public.financial_metrics (company_id, accounting_basis, reporting_period);

-- Quality monitoring: find all CONFLICTING or MISSING data points
create index if not exists financial_metrics_quality_idx
  on public.financial_metrics (company_id, data_quality_status)
  where data_quality_status in ('CONFLICTING', 'MISSING');

-- Source tier: filter by tier for source preference logic
create index if not exists financial_metrics_tier_idx
  on public.financial_metrics (company_id, source_tier);

alter table public.financial_metrics enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 5. ENHANCE public.documents
--    Adds the fields required by the spec without modifying
--    or removing any existing columns.
-- ─────────────────────────────────────────────────────────────
alter table public.documents
  add column if not exists reporting_period        text,
  add column if not exists publication_date        date,
  add column if not exists document_url            text,
  add column if not exists file_reference          text,
  add column if not exists source_tier             smallint check (source_tier between 1 and 4),
  add column if not exists source_registry_id      uuid references public.source_registry(id) on delete set null,
  add column if not exists text_extraction_status  text not null default 'pending'
    check (text_extraction_status in ('pending', 'extracting', 'complete', 'failed')),
  add column if not exists processing_status       text not null default 'unprocessed'
    check (processing_status in ('unprocessed', 'queued', 'processing', 'processed', 'failed'));

create index if not exists documents_company_period_idx
  on public.documents (company_id, reporting_period)
  where reporting_period is not null;

create index if not exists documents_processing_idx
  on public.documents (processing_status)
  where processing_status in ('unprocessed', 'queued', 'processing');

-- ─────────────────────────────────────────────────────────────
-- 6. ENHANCE public.news
--    Adds relevance, materiality, and processing status.
-- ─────────────────────────────────────────────────────────────
alter table public.news
  add column if not exists relevance_score         numeric check (relevance_score between 0 and 1),
  add column if not exists materiality             text check (materiality in ('low', 'medium', 'high')),
  add column if not exists is_processed            boolean not null default false,
  add column if not exists source_tier             smallint check (source_tier between 1 and 4),
  add column if not exists source_registry_id      uuid references public.source_registry(id) on delete set null;

create index if not exists news_unprocessed_idx
  on public.news (company_id, published_at desc)
  where is_processed = false;

-- ─────────────────────────────────────────────────────────────
-- 7. MANAGEMENT COMMENTARY
--    Stores management statements separately from AI interpretation.
--    Critical for the MANAGEMENT SAID vs WHAT HAPPENED comparison.
--    The AI must never interpret a statement here — only store it.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.management_commentary (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,

  -- The statement itself
  statement             text not null,
  speaker               text,

  -- Source
  source_document_id    uuid references public.documents(id) on delete set null,
  source_name           text not null,
  source_url            text,
  source_tier           smallint check (source_tier between 1 and 4),
  statement_date        date,

  -- Context
  reporting_period      text,
  topic                 text not null
    check (topic in ('guidance', 'explanation', 'strategy', 'outlook', 'risk', 'results', 'other')),
  guidance_type         text
    check (guidance_type in (
      'revenue_guidance', 'margin_guidance', 'volume_guidance',
      'capex_guidance', 'dividend_guidance', 'npa_guidance',
      'credit_growth_guidance', 'general', 'other'
    )),
  is_verbatim           boolean not null default false,

  -- Processing status
  is_processed          boolean not null default false,
  actual_outcome        text,
  outcome_period        text,
  outcome_assessed_at   timestamptz,

  created_at            timestamptz not null default now()
);

create index if not exists mgmt_commentary_company_period_idx
  on public.management_commentary (company_id, reporting_period);

create index if not exists mgmt_commentary_topic_idx
  on public.management_commentary (company_id, topic);

create index if not exists mgmt_commentary_unprocessed_idx
  on public.management_commentary (company_id, is_processed)
  where is_processed = false;

alter table public.management_commentary enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 8. SHAREHOLDING
--    One row per company per reporting period.
--    All percentages are of total issued capital (0-100).
--    Changes are relative to the immediately prior filing.
--    Major shareholders stored as JSONB array.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.shareholding (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete cascade,

  -- Period identification
  reporting_period          text not null,
  report_date               date not null,

  -- Share count
  total_shares              numeric,
  shares_unit               text not null default 'crores',

  -- Holding percentages (0-100)
  promoter_holding_pct      numeric check (promoter_holding_pct between 0 and 100),
  promoter_pledged_pct      numeric check (promoter_pledged_pct between 0 and 100),
  fii_fpi_holding_pct       numeric check (fii_fpi_holding_pct between 0 and 100),
  dii_holding_pct           numeric check (dii_holding_pct between 0 and 100),
  mutual_funds_holding_pct  numeric check (mutual_funds_holding_pct between 0 and 100),
  public_holding_pct        numeric check (public_holding_pct between 0 and 100),

  -- Major shareholders: [{name, category, holding_pct, change_from_prior_pct}]
  major_shareholders        jsonb not null default '[]'::jsonb,

  -- Changes from prior period: {promoter_change, fii_change, dii_change, public_change}
  change_from_prior         jsonb not null default '{}'::jsonb,

  -- Source
  source_name               text not null,
  source_url                text,
  source_tier               smallint check (source_tier between 1 and 4),
  source_registry_id        uuid references public.source_registry(id) on delete set null,
  data_quality_status       public.data_quality_status not null default 'UNVERIFIED',

  created_at                timestamptz not null default now(),

  unique (company_id, reporting_period)
);

create index if not exists shareholding_company_date_idx
  on public.shareholding (company_id, report_date desc);

alter table public.shareholding enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 9. DATA QUALITY — CONFLICT TRACKING
--    When two sources provide different values for the same
--    data point, BOTH values are stored here and the originating
--    row is marked CONFLICTING.
--    Resolution must be explicit — the system never silently
--    chooses one value over another.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.data_quality (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,

  -- Which table and row the conflict originates from
  source_table          text not null,
  source_record_id      uuid not null,
  field_name            text not null,

  -- Context for the conflict
  metric_name           text,
  reporting_period      text,
  accounting_basis      public.accounting_basis,

  -- The two conflicting values
  value_a               text not null,
  source_a_name         text not null,
  source_a_tier         smallint check (source_a_tier between 1 and 4),
  source_a_url          text,
  source_a_date         date,

  value_b               text not null,
  source_b_name         text not null,
  source_b_tier         smallint check (source_b_tier between 1 and 4),
  source_b_url          text,
  source_b_date         date,

  -- Resolution
  resolution_status     public.conflict_resolution_status not null default 'pending',
  resolved_value        text,
  resolution_notes      text,
  resolved_at           timestamptz,

  created_at            timestamptz not null default now()
);

create index if not exists data_quality_company_pending_idx
  on public.data_quality (company_id, resolution_status)
  where resolution_status = 'pending';

create index if not exists data_quality_source_record_idx
  on public.data_quality (source_record_id);

alter table public.data_quality enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 10. SEED: SOURCE REGISTRY
--     Pre-populates the known source types with their tier
--     assignments.  Using ON CONFLICT DO UPDATE so this section
--     is safe to re-run.
-- ─────────────────────────────────────────────────────────────

insert into public.source_registry
  (source_name, source_type, tier, tier_label, base_url, description)
values

-- Tier 1: Primary filings (highest trust)
('Company Annual Report',
 'annual_report', 1,
 'Tier 1: Primary Filing',
 null,
 'Audited annual report filed by the company. Includes P&L, balance sheet, cash flow statement, notes to accounts, and auditor report. Highest reliability source for financial data.'),

('NSE Exchange Filing',
 'exchange_filing', 1,
 'Tier 1: Primary Filing',
 'https://www.nseindia.com',
 'Filing submitted to the National Stock Exchange of India. Includes quarterly results, corporate actions, shareholding patterns, and material disclosures.'),

('BSE Exchange Filing',
 'exchange_filing', 1,
 'Tier 1: Primary Filing',
 'https://www.bseindia.com',
 'Filing submitted to BSE Limited. Includes quarterly results, corporate actions, shareholding patterns, and material disclosures.'),

('Statutory Auditor Report',
 'auditor_report', 1,
 'Tier 1: Primary Filing',
 null,
 'Report of the statutory auditor included in the annual report. Contains the audit opinion, key audit matters, and observations on internal financial controls.'),

('SEBI Regulatory Filing',
 'regulatory_filing', 1,
 'Tier 1: Primary Filing',
 'https://www.sebi.gov.in',
 'Filing made to the Securities and Exchange Board of India. Includes takeover disclosures, insider trading disclosures, and other regulatory submissions.'),

('MCA/RoC Filing',
 'regulatory_filing', 1,
 'Tier 1: Primary Filing',
 'https://www.mca.gov.in',
 'Filing made to the Ministry of Corporate Affairs or the Registrar of Companies. Includes annual returns, financial statements, and director disclosures.'),

('NSE/BSE Shareholding Pattern',
 'shareholding_filing', 1,
 'Tier 1: Primary Filing',
 null,
 'Quarterly shareholding pattern filed by the company with NSE and BSE as required by SEBI regulations. The authoritative source for promoter holding, FII, DII, and public holding data.'),

-- Tier 2: Company communications (second-highest trust)
('Company Investor Presentation',
 'investor_presentation', 2,
 'Tier 2: Company Communication',
 null,
 'Investor presentation published by the company. Typically released alongside quarterly results. Reliable for segment disclosures and company-stated KPIs, but not audited.'),

('Earnings Call Transcript',
 'concall_transcript', 2,
 'Tier 2: Company Communication',
 null,
 'Transcript of the quarterly or annual earnings call. Contains management guidance, Q&A, and forward-looking statements. Not audited; compare guidance against actual results.'),

('Company Press Release',
 'company_announcement', 2,
 'Tier 2: Company Communication',
 null,
 'Official press release or announcement from the company. Reliable for disclosed facts but not independently verified.'),

('Company MD&A',
 'mda', 2,
 'Tier 2: Company Communication',
 null,
 'Management Discussion and Analysis section of the annual report. Contains management''s view of business performance, outlook, and risks. Part of the annual report but management-authored.'),

('Credit Rating Report',
 'rating_report', 2,
 'Tier 2: Company Communication',
 null,
 'Credit rating report from CRISIL, ICRA, CARE, India Ratings, or international agencies. Provides an independent third-party assessment of credit quality and financial strength.'),

-- Tier 3: Reliable secondary sources
('Financial Data Provider',
 'financial_data_provider', 3,
 'Tier 3: Reliable Secondary',
 null,
 'Established financial data aggregator (e.g., Screener.in, Trendlyne, Bloomberg, Refinitiv). Useful for historical time series but must be cross-checked against primary filings for critical figures.'),

('Financial News Provider',
 'news_provider', 3,
 'Tier 3: Reliable Secondary',
 null,
 'Reputable financial publication (e.g., Business Standard, Economic Times, Mint, Moneycontrol). Useful for news and context but not authoritative for financial figures.'),

-- Tier 4: Other secondary sources
('Other Secondary Source',
 'other_secondary', 4,
 'Tier 4: Other Secondary',
 null,
 'Any source not covered by the above categories. Treat with the lowest level of trust. Must be verified against a higher-tier source before any figure is marked VERIFIED.')

on conflict (source_name) do update set
  source_type  = excluded.source_type,
  tier         = excluded.tier,
  tier_label   = excluded.tier_label,
  base_url     = coalesce(excluded.base_url, public.source_registry.base_url),
  description  = excluded.description;
