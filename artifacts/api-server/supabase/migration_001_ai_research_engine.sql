-- StockLens — AI Research Engine Foundation
-- Migration 001: company profiles, industry frameworks, evidence, cross-checks
-- Run this in the Supabase SQL editor after schema.sql has been applied.

-- ─────────────────────────────────────────────────────────────
-- 1. COMPANY PROFILES
--    Extended structured data for each company.
--    Kept separate from `companies` so the base table stays
--    lightweight for search.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.company_profiles (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  sub_industry        text,
  business_description text,                        -- detailed, analyst-grade description
  business_segments   jsonb default '[]'::jsonb,    -- [{name, description, revenue_contribution_pct}]
  revenue_sources     jsonb default '[]'::jsonb,    -- ["recurring subscriptions", "project revenue", …]
  key_products        jsonb default '[]'::jsonb,    -- ["Jio 5G", "Reliance Retail", …]
  competitors         jsonb default '[]'::jsonb,    -- [{name, ticker?, notes?}]
  profile_source      text,                         -- where this profile data was derived from
  profile_date        date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id)
);

create index if not exists company_profiles_company_idx
  on public.company_profiles (company_id);

alter table public.company_profiles enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 2. INDUSTRY FRAMEWORKS
--    Defines which analysis sections and metrics are relevant
--    for each industry type.  Populated once; reused for every
--    company in that industry.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.industry_frameworks (
  id               uuid primary key default gen_random_uuid(),
  industry_type    text not null unique,   -- 'bank', 'epc', 'manufacturing', 'it', 'conglomerate', 'default', …
  display_name     text not null,
  analysis_sections jsonb not null default '[]'::jsonb,
  -- [{section_key, section_label, description, required}]
  key_metrics      jsonb not null default '[]'::jsonb,
  -- [{metric_name, metric_label, why_it_matters, formula?}]
  cross_check_rules jsonb not null default '[]'::jsonb,
  -- [{rule_key, description, metric_a, metric_b, expected_relationship}]
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.industry_frameworks enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 3. ANALYSIS EVIDENCE
--    Every AI conclusion must be backed by a stored evidence
--    record.  The AI must choose FACT / INFERENCE / UNCERTAIN.
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create type public.evidence_type as enum ('FACT', 'INFERENCE', 'UNCERTAIN');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.confidence_level as enum ('HIGH', 'MEDIUM', 'LOW');
exception when duplicate_object then null;
end $$;

create table if not exists public.analysis_evidence (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  document_id        uuid references public.documents(id) on delete set null,
  report_section     text not null,               -- which section of the report this supports
  period             text,                        -- e.g. 'FY24', 'Q3FY25'
  claim              text not null,               -- the assertion being made
  evidence_type      public.evidence_type not null,
  supporting_source  text,                        -- document title, URL, or description
  source_date        date,
  data_point         text,                        -- specific number, quote, or fact extracted
  ai_interpretation  text,                        -- what the AI says this data means
  confidence_level   public.confidence_level not null default 'MEDIUM',
  created_at         timestamptz not null default now()
);

create index if not exists evidence_company_section_idx
  on public.analysis_evidence (company_id, report_section);
create index if not exists evidence_company_period_idx
  on public.analysis_evidence (company_id, period);

alter table public.analysis_evidence enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 4. CROSS-CHECKS
--    Stores the result of comparing related financial items.
--    Flags contradictions across P&L, cash flow, balance sheet,
--    management commentary and market data.
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create type public.cross_check_result as enum ('PASS', 'FLAG', 'WARN', 'INSUFFICIENT_DATA');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.severity_level as enum ('LOW', 'MEDIUM', 'HIGH');
exception when duplicate_object then null;
end $$;

create table if not exists public.cross_checks (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  period                text,
  rule_key              text not null,          -- e.g. 'pl_vs_cashflow', 'revenue_vs_receivables'
  rule_description      text not null,
  metric_a_name         text not null,
  metric_a_value        numeric,
  metric_b_name         text not null,
  metric_b_value        numeric,
  expected_relationship text not null,          -- e.g. 'operating_cash > accounting_profit'
  result                public.cross_check_result not null,
  finding               text,                  -- what the AI actually observed
  severity              public.severity_level,
  created_at            timestamptz not null default now()
);

create index if not exists cross_checks_company_period_idx
  on public.cross_checks (company_id, period);
create index if not exists cross_checks_result_idx
  on public.cross_checks (company_id, result);

alter table public.cross_checks enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 5. RESEARCH JOBS
--    Tracks the lifecycle of each analysis run so the pipeline
--    can be resumed, retried, and audited.
-- ─────────────────────────────────────────────────────────────
do $$ begin
  create type public.job_status as enum ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED');
exception when duplicate_object then null;
end $$;

create table if not exists public.research_jobs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  status              public.job_status not null default 'PENDING',
  industry_type       text,                   -- framework selected for this run
  sections_requested  jsonb default '[]'::jsonb,
  sections_completed  jsonb default '[]'::jsonb,
  sections_failed     jsonb default '[]'::jsonb,
  error_message       text,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists research_jobs_company_idx
  on public.research_jobs (company_id, created_at desc);
create index if not exists research_jobs_status_idx
  on public.research_jobs (status);

alter table public.research_jobs enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 6. SEED: INDUSTRY FRAMEWORKS
--    One row per industry type.  These are not company data —
--    they are the AI's instruction set.
-- ─────────────────────────────────────────────────────────────

insert into public.industry_frameworks (industry_type, display_name, analysis_sections, key_metrics, cross_check_rules)
values

-- DEFAULT (applies to every company; other frameworks extend this)
(
  'default',
  'General (all companies)',
  '[
    {"section_key":"business",        "section_label":"Business",              "description":"What the company does, how it makes money, and what drives its economics",  "required":true},
    {"section_key":"what_happened",   "section_label":"What is happening",     "description":"Recent developments in the business, not just price movements",            "required":true},
    {"section_key":"financial",       "section_label":"Financial picture",     "description":"Revenue, profit, and margin trends with evidence",                          "required":true},
    {"section_key":"cash_flow",       "section_label":"Cash flow",             "description":"Operating cash vs profit, and what is absorbing or generating cash",        "required":true},
    {"section_key":"balance_sheet",   "section_label":"Balance sheet",         "description":"Debt, equity, liquidity and asset quality",                                 "required":true},
    {"section_key":"outlook",         "section_label":"Business outlook",      "description":"Where the company and its markets appear to be headed",                     "required":true},
    {"section_key":"industry",        "section_label":"Industry",              "description":"Competitive dynamics, demand trends, regulation",                           "required":true},
    {"section_key":"management",      "section_label":"Management",            "description":"Did management deliver on prior guidance? What are they saying now?",       "required":true},
    {"section_key":"shareholders",    "section_label":"Shareholders",          "description":"Promoter/major shareholder changes and what they might signal",             "required":true},
    {"section_key":"governance",      "section_label":"Governance",            "description":"Board quality, auditor changes, disclosure standards",                      "required":false},
    {"section_key":"related_parties", "section_label":"Related-party transactions","description":"Are related-party transactions material or unusual?",                  "required":false},
    {"section_key":"red_flags",       "section_label":"Red flags",             "description":"Contradictions, unusual patterns, or accounting concerns — with evidence",  "required":true},
    {"section_key":"positives",       "section_label":"Positive developments", "description":"Genuine strengths or improvements, not marketing",                         "required":true},
    {"section_key":"valuation",       "section_label":"Valuation",             "description":"How the market is pricing the company relative to its financials",          "required":false},
    {"section_key":"takeaway",        "section_label":"Investor takeaway",     "description":"The single most important thing an investor should understand",             "required":true}
  ]'::jsonb,
  '[
    {"metric_name":"revenue_growth",    "metric_label":"Revenue growth",         "why_it_matters":"Is the top line actually expanding?"},
    {"metric_name":"ebitda_margin",     "metric_label":"EBITDA margin",          "why_it_matters":"Are revenues translating into operating profit?"},
    {"metric_name":"pat_margin",        "metric_label":"PAT margin",             "why_it_matters":"What remains for shareholders after all costs?"},
    {"metric_name":"operating_cash",    "metric_label":"Operating cash flow",    "why_it_matters":"Cash is harder to manipulate than profit"},
    {"metric_name":"fcf",               "metric_label":"Free cash flow",         "why_it_matters":"Cash left after sustaining the business"},
    {"metric_name":"debt_equity",       "metric_label":"Debt/Equity",            "why_it_matters":"How leveraged is the balance sheet?"},
    {"metric_name":"interest_coverage", "metric_label":"Interest coverage",      "why_it_matters":"Can the company comfortably service its debt?"},
    {"metric_name":"roce",              "metric_label":"ROCE",                   "why_it_matters":"Is capital being deployed productively?"}
  ]'::jsonb,
  '[
    {"rule_key":"pl_vs_cashflow",          "description":"P&L profit vs operating cash flow",         "metric_a":"pat",           "metric_b":"operating_cash",  "expected_relationship":"operating_cash should exceed pat for a healthy business"},
    {"rule_key":"revenue_vs_receivables",  "description":"Revenue growth vs receivables growth",      "metric_a":"revenue_growth","metric_b":"receivables_growth","expected_relationship":"receivables should not consistently outpace revenue"},
    {"rule_key":"profit_vs_cashflow",      "description":"Reported profit vs operating cash",         "metric_a":"ebitda",        "metric_b":"operating_cash",  "expected_relationship":"large persistent divergence warrants investigation"},
    {"rule_key":"debt_vs_interest",        "description":"Total debt vs interest expense",            "metric_a":"debt",          "metric_b":"interest_expense","expected_relationship":"implied rate should be plausible given market rates"},
    {"rule_key":"capex_vs_depreciation",   "description":"Capex vs depreciation",                    "metric_a":"capex",         "metric_b":"depreciation",    "expected_relationship":"high capex/depreciation signals heavy investment phase"},
    {"rule_key":"mgmt_guidance_vs_result", "description":"Prior management guidance vs actual outcome","metric_a":"guided_metric","metric_b":"actual_metric",  "expected_relationship":"consistent misses erode credibility"}
  ]'::jsonb
),

-- BANK
(
  'bank',
  'Bank / NBFC',
  '[
    {"section_key":"business",         "section_label":"Business",              "description":"Lending model, deposit franchise, and target customer segments",           "required":true},
    {"section_key":"what_happened",    "section_label":"What is happening",     "description":"Credit growth, deposit trends, asset quality changes",                    "required":true},
    {"section_key":"financial",        "section_label":"Financial picture",     "description":"NII, NIM, fee income, provisions, PAT",                                   "required":true},
    {"section_key":"asset_quality",    "section_label":"Asset quality",         "description":"GNPA, NNPA, slippage, provision coverage, stressed book",                 "required":true},
    {"section_key":"balance_sheet",    "section_label":"Balance sheet",         "description":"CASA ratio, CD ratio, capital adequacy (CAR/CET1)",                       "required":true},
    {"section_key":"outlook",          "section_label":"Business outlook",      "description":"Credit cycle, deposit competition, growth runway",                        "required":true},
    {"section_key":"industry",         "section_label":"Industry",              "description":"Credit growth environment, RBI policy, competitive pressure",             "required":true},
    {"section_key":"management",       "section_label":"Management",            "description":"Guidance on credit growth, NIM, and asset quality",                      "required":true},
    {"section_key":"shareholders",     "section_label":"Shareholders",          "description":"Promoter, FII, and DII holding changes",                                  "required":true},
    {"section_key":"governance",       "section_label":"Governance",            "description":"RBI audit findings, auditor notes, board independence",                  "required":true},
    {"section_key":"related_parties",  "section_label":"Related-party transactions","description":"Loans to related parties, inter-group transactions",                "required":true},
    {"section_key":"red_flags",        "section_label":"Red flags",             "description":"Divergence between reported NPA and slippage, diverging book quality",   "required":true},
    {"section_key":"positives",        "section_label":"Positive developments", "description":"CASA improvement, NPA recovery, fee income diversification",             "required":true},
    {"section_key":"valuation",        "section_label":"Valuation",             "description":"P/B, P/E vs ROE vs peers",                                               "required":true},
    {"section_key":"takeaway",         "section_label":"Investor takeaway",     "description":"Net assessment for the banking investor",                                 "required":true}
  ]'::jsonb,
  '[
    {"metric_name":"nim",                "metric_label":"Net Interest Margin (NIM)",      "why_it_matters":"Core profitability of the lending book"},
    {"metric_name":"gnpa",               "metric_label":"Gross NPA ratio",               "why_it_matters":"Proportion of bad loans in the book"},
    {"metric_name":"nnpa",               "metric_label":"Net NPA ratio",                 "why_it_matters":"Bad loans net of provisions"},
    {"metric_name":"provision_coverage", "metric_label":"Provision coverage ratio",      "why_it_matters":"How well bad loans are covered"},
    {"metric_name":"casa_ratio",         "metric_label":"CASA ratio",                    "why_it_matters":"Low-cost deposit base; higher is better for funding cost"},
    {"metric_name":"credit_growth",      "metric_label":"Credit growth (YoY)",           "why_it_matters":"Is the loan book growing and at what pace?"},
    {"metric_name":"cd_ratio",           "metric_label":"Credit/Deposit ratio",          "why_it_matters":"Liquidity and funding efficiency"},
    {"metric_name":"car",                "metric_label":"Capital Adequacy Ratio (CAR)",  "why_it_matters":"Regulatory buffer and growth capacity"},
    {"metric_name":"roa",                "metric_label":"Return on Assets (ROA)",        "why_it_matters":"Efficiency of asset utilisation"},
    {"metric_name":"roe",                "metric_label":"Return on Equity (ROE)",        "why_it_matters":"Returns to equity shareholders"},
    {"metric_name":"slippage_ratio",     "metric_label":"Slippage ratio",                "why_it_matters":"Rate at which standard loans become non-performing"},
    {"metric_name":"pb_ratio",           "metric_label":"Price to Book (P/B)",           "why_it_matters":"Market premium to book; compare to ROE"}
  ]'::jsonb,
  '[
    {"rule_key":"npa_vs_provisions",       "description":"NPA trend vs provisioning",           "metric_a":"gnpa",         "metric_b":"provision_coverage","expected_relationship":"rising NPA with falling coverage is a warning sign"},
    {"rule_key":"nim_vs_credit_cost",      "description":"NIM vs credit cost",                  "metric_a":"nim",          "metric_b":"credit_cost",       "expected_relationship":"credit cost eroding NIM narrows the profitability gap"},
    {"rule_key":"slippage_vs_mgmt_guidance","description":"Slippage rate vs management guidance","metric_a":"slippage_ratio","metric_b":"guided_slippage",  "expected_relationship":"consistent misses signal inadequate risk controls"},
    {"rule_key":"cd_ratio_trend",          "description":"Credit/deposit ratio trend",           "metric_a":"credit_growth","metric_b":"deposit_growth",    "expected_relationship":"credit outpacing deposits significantly tightens liquidity"}
  ]'::jsonb
),

-- EPC / INFRASTRUCTURE
(
  'epc',
  'EPC / Infrastructure',
  '[
    {"section_key":"business",         "section_label":"Business",              "description":"Project types, geographies, client mix, and competitive positioning",    "required":true},
    {"section_key":"what_happened",    "section_label":"What is happening",     "description":"Order inflows, execution pace, milestone billings",                      "required":true},
    {"section_key":"financial",        "section_label":"Financial picture",     "description":"Revenue, EBITDA margin, and PAT — and which projects drove them",        "required":true},
    {"section_key":"order_book",       "section_label":"Order book",            "description":"Order book size, mix, book-to-bill, and quality of orders",              "required":true},
    {"section_key":"working_capital",  "section_label":"Working capital",       "description":"Receivables, unbilled revenue, payables — EPC is working-capital-intensive","required":true},
    {"section_key":"cash_flow",        "section_label":"Cash flow",             "description":"Operating cash vs reported profit — divergence is a red flag in EPC",   "required":true},
    {"section_key":"balance_sheet",    "section_label":"Balance sheet",         "description":"Debt levels, ROCE, and whether the capital structure supports the pipeline","required":true},
    {"section_key":"outlook",          "section_label":"Business outlook",      "description":"Bidding pipeline, sector spending trends, government capex",             "required":true},
    {"section_key":"industry",         "section_label":"Industry",              "description":"Government spending, commodity costs, competition intensity",            "required":true},
    {"section_key":"management",       "section_label":"Management",            "description":"Execution track record — does margin guidance match delivery?",          "required":true},
    {"section_key":"shareholders",     "section_label":"Shareholders",          "description":"Promoter holding and pledge levels",                                      "required":true},
    {"section_key":"governance",       "section_label":"Governance",            "description":"Auditor qualifications, contingent liabilities, claims/disputes",       "required":true},
    {"section_key":"related_parties",  "section_label":"Related-party transactions","description":"Subcontracting and transactions with promoter-linked entities",     "required":true},
    {"section_key":"red_flags",        "section_label":"Red flags",             "description":"Rising receivables, low cash conversion, promoter pledge",              "required":true},
    {"section_key":"positives",        "section_label":"Positive developments", "description":"Strong order inflows, improving execution, margin expansion",           "required":true},
    {"section_key":"valuation",        "section_label":"Valuation",             "description":"P/E, EV/EBITDA vs order book and execution track record",               "required":false},
    {"section_key":"takeaway",         "section_label":"Investor takeaway",     "description":"Net assessment for the EPC investor",                                    "required":true}
  ]'::jsonb,
  '[
    {"metric_name":"order_book",         "metric_label":"Order book (₹ cr)",          "why_it_matters":"Visibility into future revenue"},
    {"metric_name":"book_to_bill",       "metric_label":"Book-to-bill ratio",         "why_it_matters":"Order book as multiple of annual revenue; visibility buffer"},
    {"metric_name":"order_inflow",       "metric_label":"Order inflow (YoY)",         "why_it_matters":"Is the pipeline being replenished?"},
    {"metric_name":"ebitda_margin",      "metric_label":"EBITDA margin",              "why_it_matters":"Are project economics improving or deteriorating?"},
    {"metric_name":"roce",               "metric_label":"ROCE",                       "why_it_matters":"Capital efficiency in a capital-intensive business"},
    {"metric_name":"debtor_days",        "metric_label":"Debtor days",                "why_it_matters":"Rising debtor days signal collection risk or aggressive revenue recognition"},
    {"metric_name":"unbilled_revenue",   "metric_label":"Unbilled revenue (₹ cr)",   "why_it_matters":"Large unbilled balances can inflate revenue before cash is collected"},
    {"metric_name":"cash_conversion",    "metric_label":"Cash conversion ratio",      "why_it_matters":"Operating cash / EBITDA — <0.5 is a warning in EPC"},
    {"metric_name":"net_debt",           "metric_label":"Net debt (₹ cr)",           "why_it_matters":"Leverage relative to EBITDA"},
    {"metric_name":"promoter_pledge",    "metric_label":"Promoter pledge %",          "why_it_matters":"High pledge signals financial stress at promoter level"}
  ]'::jsonb,
  '[
    {"rule_key":"revenue_vs_receivables", "description":"Revenue growth vs receivables/unbilled growth","metric_a":"revenue_growth","metric_b":"receivables_growth","expected_relationship":"receivables consistently outpacing revenue is a red flag"},
    {"rule_key":"profit_vs_cashflow",     "description":"Reported profit vs operating cash flow",        "metric_a":"pat",           "metric_b":"operating_cash",    "expected_relationship":"persistent divergence signals aggressive recognition or collection issues"},
    {"rule_key":"order_book_vs_revenue",  "description":"Order book trend vs revenue delivery",          "metric_a":"order_book",    "metric_b":"revenue",           "expected_relationship":"stagnant or falling book-to-bill despite claimed pipeline is a warning"},
    {"rule_key":"mgmt_margin_guidance",   "description":"Management margin guidance vs delivered margin","metric_a":"guided_margin", "metric_b":"actual_margin",     "expected_relationship":"consistent misses reduce credibility of forward guidance"}
  ]'::jsonb
),

-- MANUFACTURING
(
  'manufacturing',
  'Manufacturing',
  '[
    {"section_key":"business",          "section_label":"Business",              "description":"Products, end-markets, customer concentration, and competitive moat",   "required":true},
    {"section_key":"what_happened",     "section_label":"What is happening",     "description":"Volume, realisation, and capacity changes",                             "required":true},
    {"section_key":"financial",         "section_label":"Financial picture",     "description":"Revenue, margins, and what drove the change",                           "required":true},
    {"section_key":"capacity",          "section_label":"Capacity & utilisation","description":"Current capacity, utilisation, and planned expansion",                  "required":true},
    {"section_key":"working_capital",   "section_label":"Working capital",       "description":"Inventory, receivables, payables, and cash conversion cycle",           "required":true},
    {"section_key":"cash_flow",         "section_label":"Cash flow",             "description":"Operating cash, capex cycle, and free cash generation",                 "required":true},
    {"section_key":"balance_sheet",     "section_label":"Balance sheet",         "description":"Asset turnover, debt and leverage relative to EBITDA",                  "required":true},
    {"section_key":"outlook",           "section_label":"Business outlook",      "description":"Demand environment, pricing power, and expansion plans",                "required":true},
    {"section_key":"industry",          "section_label":"Industry",              "description":"Demand cycles, commodity input costs, import competition",              "required":true},
    {"section_key":"management",        "section_label":"Management",            "description":"Capex commitments, volume guidance, and delivery track record",         "required":true},
    {"section_key":"shareholders",      "section_label":"Shareholders",          "description":"Promoter holding, institutional interest",                              "required":true},
    {"section_key":"governance",        "section_label":"Governance",            "description":"Auditor notes, contingent liabilities, related-party sales",           "required":false},
    {"section_key":"related_parties",   "section_label":"Related-party transactions","description":"Sales to or purchases from promoter-linked entities",             "required":false},
    {"section_key":"red_flags",         "section_label":"Red flags",             "description":"Inventory build, margin deterioration, cash conversion decline",       "required":true},
    {"section_key":"positives",         "section_label":"Positive developments", "description":"Market share gains, new products, margin expansion",                   "required":true},
    {"section_key":"valuation",         "section_label":"Valuation",             "description":"EV/EBITDA, P/E vs cycle position and ROE",                             "required":false},
    {"section_key":"takeaway",          "section_label":"Investor takeaway",     "description":"Net assessment for the manufacturing investor",                         "required":true}
  ]'::jsonb,
  '[
    {"metric_name":"capacity_utilisation","metric_label":"Capacity utilisation %",    "why_it_matters":"Operating leverage — utilisation above 80% is where margins improve"},
    {"metric_name":"volume_growth",       "metric_label":"Volume growth (YoY)",       "why_it_matters":"Distinguishes real demand growth from price-driven revenue"},
    {"metric_name":"realisation_per_unit","metric_label":"Realisation per unit",      "why_it_matters":"Pricing power or commodity passthrough"},
    {"metric_name":"gross_margin",        "metric_label":"Gross margin",              "why_it_matters":"Impact of input costs before fixed-cost absorption"},
    {"metric_name":"ebitda_margin",       "metric_label":"EBITDA margin",             "why_it_matters":"Operating profitability after variable and fixed costs"},
    {"metric_name":"asset_turnover",      "metric_label":"Asset turnover",            "why_it_matters":"Revenue generated per rupee of assets"},
    {"metric_name":"roce",                "metric_label":"ROCE",                      "why_it_matters":"Core profitability measure for capital-intensive businesses"},
    {"metric_name":"inventory_days",      "metric_label":"Inventory days",            "why_it_matters":"Rising inventory relative to sales can signal demand slowdown"},
    {"metric_name":"capex_to_sales",      "metric_label":"Capex to sales ratio",      "why_it_matters":"Investment intensity; compare to capacity additions"},
    {"metric_name":"fcf_yield",           "metric_label":"Free cash flow yield",      "why_it_matters":"Cash actually generated for shareholders"}
  ]'::jsonb,
  '[
    {"rule_key":"volume_vs_revenue",      "description":"Volume growth vs revenue growth",             "metric_a":"volume_growth","metric_b":"revenue_growth",    "expected_relationship":"large divergence implies price movement, not demand"},
    {"rule_key":"inventory_vs_sales",     "description":"Inventory build vs sales growth",             "metric_a":"inventory_growth","metric_b":"revenue_growth", "expected_relationship":"inventory growing much faster than sales suggests demand slowdown"},
    {"rule_key":"capex_vs_utilisation",   "description":"Capex programme vs current utilisation",      "metric_a":"capex",        "metric_b":"utilisation_pct",   "expected_relationship":"large capex at <70% utilisation needs a clear demand rationale"},
    {"rule_key":"margin_vs_input_cost",   "description":"EBITDA margin vs raw material cost trend",    "metric_a":"ebitda_margin","metric_b":"rm_cost_pct",       "expected_relationship":"margin improvement despite rising RM costs implies pricing power"}
  ]'::jsonb
),

-- IT SERVICES
(
  'it_services',
  'IT Services / Technology',
  '[
    {"section_key":"business",          "section_label":"Business",              "description":"Service lines, verticals, client concentration, and delivery model",    "required":true},
    {"section_key":"what_happened",     "section_label":"What is happening",     "description":"Revenue growth, deal wins, and discretionary spending environment",    "required":true},
    {"section_key":"financial",         "section_label":"Financial picture",     "description":"Revenue, EBIT margin, headcount, and USD revenue growth",              "required":true},
    {"section_key":"deals",             "section_label":"Deal pipeline & wins",  "description":"Large deal TCV, deal type (new vs renewal), and ramp timelines",       "required":true},
    {"section_key":"cash_flow",         "section_label":"Cash flow",             "description":"IT typically generates strong cash; watch DSO and buyback capacity",  "required":true},
    {"section_key":"balance_sheet",     "section_label":"Balance sheet",         "description":"Cash-heavy; assess capital return policy",                             "required":true},
    {"section_key":"outlook",           "section_label":"Business outlook",      "description":"Client spending environment, AI impact, and vertical mix",             "required":true},
    {"section_key":"industry",          "section_label":"Industry",              "description":"Global IT spend, offshoring trends, AI disruption risk",              "required":true},
    {"section_key":"management",        "section_label":"Management",            "description":"Growth guidance range, margin levers cited, and delivery",             "required":true},
    {"section_key":"shareholders",      "section_label":"Shareholders",          "description":"Promoter holding, FII flows, buyback history",                         "required":true},
    {"section_key":"governance",        "section_label":"Governance",            "description":"Client concentration risk, key-person risk, auditor notes",           "required":false},
    {"section_key":"related_parties",   "section_label":"Related-party transactions","description":"Promoter-entity transactions, subsidiary loans",                 "required":false},
    {"section_key":"red_flags",         "section_label":"Red flags",             "description":"Revenue recognition issues, attrition spikes, deal misses",           "required":true},
    {"section_key":"positives",         "section_label":"Positive developments", "description":"Large deal momentum, margin expansion, AI-led revenue growth",        "required":true},
    {"section_key":"valuation",         "section_label":"Valuation",             "description":"P/E vs growth vs peers; FCF yield",                                    "required":false},
    {"section_key":"takeaway",          "section_label":"Investor takeaway",     "description":"Net assessment for the IT services investor",                          "required":true}
  ]'::jsonb,
  '[
    {"metric_name":"revenue_growth_cc",  "metric_label":"Revenue growth (constant currency)",   "why_it_matters":"Removes FX noise from the growth picture"},
    {"metric_name":"ebit_margin",        "metric_label":"EBIT margin",                          "why_it_matters":"Operating profitability after people costs"},
    {"metric_name":"utilisation",        "metric_label":"Utilisation rate %",                   "why_it_matters":"Efficiency of the delivery workforce"},
    {"metric_name":"attrition",          "metric_label":"Attrition rate (LTM)",                 "why_it_matters":"High attrition increases cost and delivery risk"},
    {"metric_name":"large_deal_tcv",     "metric_label":"Large deal TCV",                       "why_it_matters":"Forward revenue visibility; new vs renewal mix matters"},
    {"metric_name":"headcount_growth",   "metric_label":"Net headcount growth",                 "why_it_matters":"Inverse indicator of demand when headcount is being cut"},
    {"metric_name":"dso",                "metric_label":"Days Sales Outstanding (DSO)",         "why_it_matters":"Rising DSO can signal collection difficulty or aggressive recognition"},
    {"metric_name":"fcf_conversion",     "metric_label":"FCF conversion (FCF/PAT)",             "why_it_matters":"IT should convert >90% of profit to cash — deviation is a flag"},
    {"metric_name":"revenue_per_employee","metric_label":"Revenue per employee",                "why_it_matters":"Productivity trend; improvement required with AI headwinds"}
  ]'::jsonb,
  '[
    {"rule_key":"revenue_vs_headcount",  "description":"Revenue growth vs headcount growth",         "metric_a":"revenue_growth","metric_b":"headcount_growth",  "expected_relationship":"flat headcount with revenue growth is positive; reverse is a warning"},
    {"rule_key":"dso_vs_revenue",        "description":"DSO trend vs revenue recognition",           "metric_a":"dso",           "metric_b":"revenue_growth",    "expected_relationship":"rising DSO alongside revenue growth may signal aggressive recognition"},
    {"rule_key":"deal_wins_vs_revenue",  "description":"Deal TCV vs revenue ramp",                  "metric_a":"deal_tcv",      "metric_b":"revenue_growth",    "expected_relationship":"strong TCV not converting to revenue after 2-4 quarters needs explanation"},
    {"rule_key":"mgmt_margin_guidance",  "description":"Management margin guidance vs delivered",   "metric_a":"guided_margin", "metric_b":"actual_margin",     "expected_relationship":"consistent misses or beats indicate guidance quality"}
  ]'::jsonb
),

-- CONGLOMERATE (Reliance-type)
(
  'conglomerate',
  'Conglomerate / Diversified',
  '[
    {"section_key":"business",          "section_label":"Business",              "description":"Each major segment, how they interact, and the group''s strategic logic", "required":true},
    {"section_key":"what_happened",     "section_label":"What is happening",     "description":"Segment-level performance; which parts drove the consolidated result",  "required":true},
    {"section_key":"financial",         "section_label":"Financial picture",     "description":"Consolidated and segment revenue, EBITDA, and PAT",                     "required":true},
    {"section_key":"cash_flow",         "section_label":"Cash flow",             "description":"Operating cash vs profit; capex allocation across segments",            "required":true},
    {"section_key":"balance_sheet",     "section_label":"Balance sheet",         "description":"Consolidated debt, segment-level leverage, and capital allocation",     "required":true},
    {"section_key":"outlook",           "section_label":"Business outlook",      "description":"Each major segment''s outlook and the group''s investment priorities",    "required":true},
    {"section_key":"industry",          "section_label":"Industry",              "description":"Key industry trends affecting each segment",                             "required":true},
    {"section_key":"management",        "section_label":"Management",            "description":"Group strategy, segment guidance, and delivery track record",           "required":true},
    {"section_key":"shareholders",      "section_label":"Shareholders",          "description":"Promoter holding, institutional flows",                                  "required":true},
    {"section_key":"governance",        "section_label":"Governance",            "description":"Group structure complexity, inter-company transactions, auditor notes", "required":true},
    {"section_key":"related_parties",   "section_label":"Related-party transactions","description":"Inter-segment and promoter-linked transactions at scale",          "required":true},
    {"section_key":"red_flags",         "section_label":"Red flags",             "description":"Segment cross-subsidies, rising group debt, opaque structure",         "required":true},
    {"section_key":"positives",         "section_label":"Positive developments", "description":"Segment re-rating, strong consumer growth, new business scale-up",     "required":true},
    {"section_key":"valuation",         "section_label":"Valuation",             "description":"Sum-of-parts vs consolidated market cap; segment multiples",           "required":true},
    {"section_key":"takeaway",          "section_label":"Investor takeaway",     "description":"Net assessment across all segments",                                    "required":true}
  ]'::jsonb,
  '[
    {"metric_name":"segment_ebitda_mix", "metric_label":"Segment EBITDA mix",            "why_it_matters":"Which businesses actually drive profitability?"},
    {"metric_name":"consolidated_roce",  "metric_label":"Consolidated ROCE",              "why_it_matters":"Is the sum of all capital deployment productive?"},
    {"metric_name":"net_debt",           "metric_label":"Net debt (₹ cr)",               "why_it_matters":"Conglomerates can hide debt in subsidiaries"},
    {"metric_name":"fcf",                "metric_label":"Free cash flow",                 "why_it_matters":"After heavy capex across segments, is real cash generated?"},
    {"metric_name":"capex_allocation",   "metric_label":"Capex by segment",               "why_it_matters":"Where is management placing its bets?"},
    {"metric_name":"sop_discount",       "metric_label":"SOP discount to market cap",     "why_it_matters":"How much is the market discounting the conglomerate structure?"},
    {"metric_name":"revenue_growth_consumer","metric_label":"Consumer segment revenue growth","why_it_matters":"Recurring consumer businesses reduce cyclicality dependence"}
  ]'::jsonb,
  '[
    {"rule_key":"segment_cash_vs_group_debt","description":"Segment cash generation vs group debt repayment","metric_a":"operating_cash","metric_b":"net_debt_change","expected_relationship":"rising group debt while segments generate cash needs explanation"},
    {"rule_key":"capex_vs_returns",     "description":"Capex vs eventual returns by segment",               "metric_a":"capex",         "metric_b":"roce_by_segment", "expected_relationship":"sustained low ROCE segments absorbing disproportionate capex is a flag"},
    {"rule_key":"related_party_scale",  "description":"Related-party transactions vs group revenue",        "metric_a":"rpt_value",     "metric_b":"revenue",         "expected_relationship":"RPT growing faster than revenue in a conglomerate requires scrutiny"}
  ]'::jsonb
)

on conflict (industry_type) do update set
  display_name       = excluded.display_name,
  analysis_sections  = excluded.analysis_sections,
  key_metrics        = excluded.key_metrics,
  cross_check_rules  = excluded.cross_check_rules,
  updated_at         = now();

-- ─────────────────────────────────────────────────────────────
-- 7. SEED: RELIANCE COMPANY PROFILE
--    Links the existing Reliance row to the new profile table.
-- ─────────────────────────────────────────────────────────────
insert into public.company_profiles (
  company_id,
  sub_industry,
  business_description,
  business_segments,
  revenue_sources,
  key_products,
  competitors,
  profile_source,
  profile_date
) values (
  '11111111-1111-4111-8111-111111111111',
  'Integrated Conglomerate',
  'Reliance Industries Limited is India''s largest private sector company by revenue and market capitalisation. It operates across three major verticals: Jio Platforms (digital and telecom services), Reliance Retail (organised retail across grocery, fashion, electronics and B2B commerce), and Oil-to-Chemicals (O2C: refining, petrochemicals, fuel marketing). A fourth vertical, New Energy, is in the investment phase covering solar, hydrogen and battery technologies. The group generates cash primarily from O2C and is deploying it into the consumer and new-energy businesses.',
  '[
    {"name":"Jio Platforms",         "description":"Mobile data, home broadband, digital services and B2B connectivity",     "revenue_contribution_pct": null},
    {"name":"Reliance Retail",       "description":"Grocery, fashion, electronics, B2B commerce and JioMart",                "revenue_contribution_pct": null},
    {"name":"Oil-to-Chemicals (O2C)","description":"Crude refining, petrochemicals and fuel marketing",                      "revenue_contribution_pct": null},
    {"name":"New Energy",            "description":"Solar manufacturing, green hydrogen and energy storage — investment phase","revenue_contribution_pct": null}
  ]'::jsonb,
  '[
    "Mobile data and voice ARPU (Jio)",
    "Home broadband subscriptions (JioFiber)",
    "Digital subscription services (JioCinema, JioSaavn)",
    "Retail store sales and private label",
    "B2B commerce and distribution",
    "Fuel and petrochemical product sales (O2C)"
  ]'::jsonb,
  '[
    "Jio 5G network",
    "JioFiber broadband",
    "JioCinema streaming",
    "Reliance Retail stores (Smart Bazaar, Trends, Jio Points)",
    "JioMart grocery platform",
    "Jamnagar refinery complex"
  ]'::jsonb,
  '[
    {"name":"Airtel",          "ticker":"BHARTIARTL", "notes":"Competes directly with Jio in mobile and broadband"},
    {"name":"Vodafone Idea",   "ticker":"IDEA",       "notes":"Weakened third telecom player"},
    {"name":"DMart",           "ticker":"DMART",      "notes":"Competes with Reliance Retail in grocery"},
    {"name":"Tata Digital",    "ticker":null,         "notes":"Tata Neu competes across retail and digital"},
    {"name":"IOC / BPCL",      "ticker":"IOC",        "notes":"Downstream fuel peers in O2C and fuel retail"}
  ]'::jsonb,
  'StockLens prototype — demo profile, not sourced from live filings',
  '2026-08-18'
)
on conflict (company_id) do update set
  sub_industry         = excluded.sub_industry,
  business_description = excluded.business_description,
  business_segments    = excluded.business_segments,
  revenue_sources      = excluded.revenue_sources,
  key_products         = excluded.key_products,
  competitors          = excluded.competitors,
  profile_source       = excluded.profile_source,
  profile_date         = excluded.profile_date,
  updated_at           = now();
