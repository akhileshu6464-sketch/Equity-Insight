-- StockLens Supabase schema
-- Run this file in the Supabase SQL editor once for the selected project.
-- The four demo content tables intentionally contain illustrative content.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ticker text not null unique,
  exchange text not null,
  sector text not null,
  industry text not null,
  short_description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_data (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period text not null,
  revenue numeric,
  ebitda numeric,
  profit numeric,
  cash_flow numeric,
  debt numeric,
  cash numeric,
  receivables numeric,
  inventory numeric,
  payables numeric,
  capex numeric,
  created_at timestamptz not null default now(),
  unique (company_id, period)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  document_type text not null,
  document_date date,
  source_name text,
  source_url text,
  content text,
  created_at timestamptz not null default now()
);

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  headline text not null,
  summary text,
  published_at timestamptz,
  source_name text,
  source_url text,
  category text not null default 'Other',
  created_at timestamptz not null default now()
);

create table if not exists public.research (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  section text not null,
  title text not null,
  content text not null,
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists companies_name_idx on public.companies using gin (to_tsvector('simple', name));
create index if not exists research_company_order_idx on public.research (company_id, created_at);
create index if not exists news_company_published_idx on public.news (company_id, published_at desc);

alter table public.companies enable row level security;
alter table public.financial_data enable row level security;
alter table public.documents enable row level security;
alter table public.news enable row level security;
alter table public.research enable row level security;

-- There are intentionally no anonymous policies. StockLens reads through the
-- server using SUPABASE_SECRET_KEY, while future public/authenticated policies
-- can be added once the product's access model is decided.

insert into public.companies (
  id, name, ticker, exchange, sector, industry, short_description
) values (
  '11111111-1111-4111-8111-111111111111',
  'Reliance Industries',
  'RELIANCE',
  'NSE',
  'Diversified',
  'Conglomerate',
  'A demo research note that explains Reliance in plain English. All content in this prototype is illustrative and not live investment research.'
)
on conflict (ticker) do update set
  name = excluded.name,
  exchange = excluded.exchange,
  sector = excluded.sector,
  industry = excluded.industry,
  short_description = excluded.short_description,
  updated_at = now();

insert into public.financial_data (
  id, company_id, period, revenue, ebitda, profit, cash_flow, debt, cash,
  receivables, inventory, payables, capex
) values (
  '21111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'DEMO FY24',
  1000000,
  180000,
  79000,
  129000,
  320000,
  210000,
  120000,
  175000,
  140000,
  131000
)
on conflict (company_id, period) do update set
  revenue = excluded.revenue,
  ebitda = excluded.ebitda,
  profit = excluded.profit,
  cash_flow = excluded.cash_flow,
  debt = excluded.debt,
  cash = excluded.cash,
  receivables = excluded.receivables,
  inventory = excluded.inventory,
  payables = excluded.payables,
  capex = excluded.capex;

insert into public.documents (
  id, company_id, title, document_type, document_date, source_name, content
) values
(
  '31111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'Reliance demo research pack',
  'demo_note',
  '2025-06-30',
  'StockLens prototype',
  'Illustrative demo text only. Replace with sourced filings, presentations and transcripts before using this in production.'
),
(
  '31111111-1111-4111-8111-111111111112',
  '11111111-1111-4111-8111-111111111111',
  'Reliance content map',
  'demo_note',
  '2025-06-30',
  'StockLens prototype',
  'The research rows below are shaped for a future analysis pipeline. They are not verified live financial research.'
)
on conflict (id) do update set
  title = excluded.title,
  document_type = excluded.document_type,
  document_date = excluded.document_date,
  source_name = excluded.source_name,
  content = excluded.content;

insert into public.news (
  id, company_id, headline, summary, published_at, source_name, category
) values
(
  '41111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'Demo: consumer businesses remain the growth focus',
  'Illustrative headline for the StockLens prototype. Replace with sourced news before production use.',
  '2025-06-30T00:00:00Z',
  'StockLens prototype',
  'Business'
),
(
  '41111111-1111-4111-8111-111111111112',
  '11111111-1111-4111-8111-111111111111',
  'Demo: investors weigh O2C cycle against new investments',
  'Illustrative headline for the StockLens prototype. Replace with sourced news before production use.',
  '2025-06-15T00:00:00Z',
  'StockLens prototype',
  'Industry'
)
on conflict (id) do update set
  headline = excluded.headline,
  summary = excluded.summary,
  published_at = excluded.published_at,
  source_name = excluded.source_name,
  category = excluded.category;

insert into public.research (id, company_id, section, title, content)
values
(
  '51111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'company',
  'What does Reliance actually do?',
  'Reliance is not one business. It is a group of large businesses that touch how India communicates, shops and uses energy.

Its consumer businesses are Jio, which connects people to mobile data and digital services, and Reliance Retail, which sells everything from groceries to fashion and electronics. Its older energy businesses buy crude oil, turn it into fuels and chemicals, and sell them in India and overseas.

Jio and Retail matter because they can grow with Indian households. Oil-to-Chemicals, or O2C, still matters because it is large and generates cash — but its earnings move with global product prices and supply.

DEMO CONTENT: replace this note with sourced company research before production use.'
),
(
  '51111111-1111-4111-8111-111111111112',
  '11111111-1111-4111-8111-111111111111',
  'business_model',
  'How does Reliance make money?',
  'Jio earns recurring revenue from mobile data, calls, home broadband and digital subscriptions. More usage and higher-value plans can increase revenue per customer.

Retail earns a margin on products it buys and sells. Scale, store growth and private-label products can improve the economics over time.

O2C buys crude and sells fuels and chemicals. The gap between input cost and selling price is the profit, so this business moves with global supply, demand and competition.

New energy is currently an investment story rather than a meaningful profit pool. Its future depends on factories being built on time and products becoming cost competitive.

DEMO CONTENT: replace this note with sourced company research before production use.'
),
(
  '51111111-1111-4111-8111-111111111113',
  '11111111-1111-4111-8111-111111111111',
  'what_happened',
  'What happened to the business?',
  'The company kept growing, but the mix changed. Jio and Retail did more of the heavy lifting while O2C had a softer period.

WHAT HAPPENED? Energy realisations were weaker, so consolidated revenue was broadly flat to slightly lower in this illustrative period.

WHY DID IT HAPPEN? Global chemical spreads and fuel margins cooled from a strong prior year. Consumer demand and tariff-led growth partly offset that pressure.

WHY DOES IT MATTER? A more balanced Reliance is less dependent on one good energy cycle. The question is whether consumer growth can become large enough to carry the group through weak O2C periods.

DEMO CONTENT: illustrative sample analysis, not live data.'
),
(
  '51111111-1111-4111-8111-111111111114',
  '11111111-1111-4111-8111-111111111111',
  'earnings',
  'Why did earnings change?',
  'WHAT HAPPENED? Consolidated profit grew in the illustrative period even though revenue did not show the same pace.

WHY DID IT HAPPEN? Jio benefited from better pricing and data use, and Retail added stores. O2C margins normalised after an unusually strong earlier period.

WHY DOES IT MATTER? The group still has two different earnings clocks: recurring consumer income and volatile global commodity income. Profit growth is more reassuring when it comes from customer additions and better mix, not only from a temporary energy margin.

DEMO CONTENT: illustrative sample analysis, not live data.'
),
(
  '51111111-1111-4111-8111-111111111115',
  '11111111-1111-4111-8111-111111111111',
  'cash_flow',
  'Why did cash flow change?',
  'The illustrative sample reports about ₹79,000 crore of profit and roughly ₹1,29,000 crore of cash from operations. That is a healthy relationship because operating cash is above accounting profit.

Some cash was absorbed by inventory and receivables as Retail expanded. Capital expenditure remained high at around ₹1,31,000 crore, reflecting networks, stores and new-energy projects.

WHAT SHOULD WE WATCH NEXT? High capex is not automatically bad here. The test is whether it creates future cash earnings and whether operating cash begins to cover the investment programme.

DEMO CONTENT: illustrative sample analysis, not live data.'
),
(
  '51111111-1111-4111-8111-111111111116',
  '11111111-1111-4111-8111-111111111111',
  'industry',
  'What is happening in the industry?',
  'Telecom demand is becoming more data-heavy, organised retail is taking share from fragmented trade, and energy markets remain cyclical.

WHAT HAPPENED? Jio and Retail participate in large Indian growth markets while O2C remains exposed to global commodity cycles.

WHY DOES IT MATTER? Reliance has opportunity because the consumer markets can compound, but each market has different competitors, regulation and return timelines.

DEMO CONTENT: illustrative sample analysis, not live data.'
),
(
  '51111111-1111-4111-8111-111111111117',
  '11111111-1111-4111-8111-111111111111',
  'management',
  'What is management saying — and did it deliver?',
  'Management’s message is consistent: invest through the cycle, make consumer businesses bigger, and build the next energy platform.

WHAT HAPPENED? Jio’s network and tariff execution broadly matched the direction shared earlier, and Retail kept expanding.

WHY DOES IT MATTER? The strategy makes sense only if capital turns into customer cash flows at a reasonable return. New-energy delivery is not yet proven at the scale implied by the plan.

DEMO CONTENT: illustrative sample analysis, not live management commentary.'
),
(
  '51111111-1111-4111-8111-111111111118',
  '11111111-1111-4111-8111-111111111111',
  'stock_move',
  'Why did the stock move?',
  'The market reacts to the gap between what it expected and what it heard, not only to whether a result looks good in isolation.

In this illustrative period, stronger Jio and Retail expectations supported the stock, while softer O2C margins and questions about new-energy spending checked enthusiasm.

The move was less “earnings were bad” and more “the good parts were partly expected, while timing and returns on the next investment cycle remain uncertain.”

DEMO CONTENT: illustrative sample analysis, not live price analysis.'
),
(
  '51111111-1111-4111-8111-111111111119',
  '11111111-1111-4111-8111-111111111111',
  'what_is_going_well',
  'What is going well?',
  'Jio is becoming a steadier earnings engine because tariffs, 5G adoption and home broadband provide several ways to grow revenue per user.

Retail is still adding reach through store expansion and a wider product mix. Strong operating cash gives the group room to invest, and the business mix is gradually reducing dependence on a single energy cycle.

DEMO CONTENT: illustrative sample analysis, not live data.'
),
(
  '51111111-1111-4111-8111-111111111120',
  '11111111-1111-4111-8111-111111111111',
  'what_is_going_wrong',
  'What is going wrong?',
  'O2C has less room for easy growth because weaker global margins and new capacity can pressure a business that used to be the group’s star.

Retail is cash hungry while it scales, new energy is still a promise with spending visible before cash earnings, and expectations are high enough that good growth can still disappoint.

DEMO CONTENT: illustrative sample analysis, not live data.'
),
(
  '51111111-1111-4111-8111-111111111121',
  '11111111-1111-4111-8111-111111111111',
  'red_flags',
  'Red flags to keep in view',
  'RED FLAG: Receivables are growing faster than revenue.
FACT: In this illustrative sample, receivables rose about 18% while revenue rose about 8%.
ANALYSIS: The gap may reflect Retail partnerships, timing and a larger digital ecosystem.
POSSIBLE RISK: If it persists, more cash could be tied up and profit could arrive later as cash.
SEVERITY: Watch.

RED FLAG: Capex is running ahead of visible returns.
FACT: Annual capex is around ₹1.31 lakh crore in the illustrative sample.
ANALYSIS: Reliance is investing ahead of demand in businesses that could be large later.
POSSIBLE RISK: Delays or weak returns could reduce free cash flow.
SEVERITY: Moderate.

These are signals to investigate, not accusations. Unusual numbers need context before they deserve a strong conclusion.

DEMO CONTENT: illustrative sample analysis, not live data.'
),
(
  '51111111-1111-4111-8111-111111111122',
  '11111111-1111-4111-8111-111111111111',
  'risks',
  'What could go wrong?',
  'Consumer competition could force lower tariffs or higher customer-acquisition spending.

An O2C downcycle could last longer than expected. Large projects may earn less, or much later, than investors assume. Telecom or retail regulation could change the economics. Finally, managing stores, networks, factories and a commodity chain at once creates many places for delays and cost overruns.

DEMO CONTENT: illustrative sample risks, not investment advice.'
),
(
  '51111111-1111-4111-8111-111111111123',
  '11111111-1111-4111-8111-111111111111',
  'what_to_watch',
  'What should investors watch next?',
  'Watch whether Jio’s tariffs and data use lift revenue per user without unusually high churn.

Watch whether Retail stores mature and whether inventory and receivables grow slower than sales.

Watch whether O2C margins stabilise, whether new-energy plants are commissioned on schedule, and whether operating cash begins to cover the group’s large investment programme.

DEMO CONTENT: illustrative sample watchlist, not investment advice.'
),
(
  '51111111-1111-4111-8111-111111111124',
  '11111111-1111-4111-8111-111111111111',
  'summary',
  'Reliance in 60 seconds',
  'Reliance is becoming a consumer-and-energy platform rather than only an energy company. Jio and Retail offer recurring customer relationships and long runways in India, while O2C remains a powerful but cyclical cash engine.

The hard part is that the company is spending heavily before every future business has proved its returns. The biggest risk is not one bad quarter; it is capital earning less, or later, than expected.

The most important thing to watch is simple: do Jio, Retail and new energy turn the money invested today into durable cash generation tomorrow?

DEMO CONTENT: illustrative sample conclusion, not investment advice.'
)
on conflict (id) do update set
  title = excluded.title,
  content = excluded.content,
  last_updated = now();