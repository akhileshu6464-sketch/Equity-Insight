# StockLens — Product Requirements & Build Log

## 1. Original problem statement

Build StockLens: a professional AI-powered Initiating Coverage equity
research platform for the Indian market. Cloned from
`akhileshu6464-sketch/Equity-Insight`. Preserve existing checklist,
Supabase ingestion, retrieval, AI, calculations, evidence system, and UI.

## 2. Live URLs

- **Preview**: `https://market-view-19.preview.emergentagent.com/`
- **Multi-agent research report**: `/live-report/RELIANCE`, `/live-report/TCS`
- **Company Intelligence**: `/intelligence/RELIANCE`, `/intelligence/TCS`
- **Backend proxy**: `/api/*` (FastAPI on :8001 → Express on :8002)
- **Sample-report legacy URL**: `/research/reliance-industries` → aliased to LiveReport

## 3. Architecture

```
┌────────────────────┐         ┌───────────────────────────────────────────┐
│ React (Vite) 3000  │ ──────▶ │ FastAPI 8001 ─ proxy ─▶ Node 8002 Express │
└────────────────────┘         │                          + scheduler       │
                               └───────────────────────────────────────────┘
                                                   │
                                                   ▼
                                   ┌─────────────────────────────────┐
                                   │ Supabase REST (existing DB)     │
                                   │ + OpenAI (gpt-4o-mini)          │
                                   │ + Google News RSS               │
                                   │ + BSE Corporate Announcements   │
                                   └─────────────────────────────────┘
```

## 4. Multi-Agent Research Engine (previous milestone)

`/app/artifacts/api-server/src/lib/research/agents/`:
- 1 Master + 7 Specialists + deterministic QA validator + calculator
- 30 report sections persisted to Supabase `research` table
- Reliance test: 68 findings (64 supported), QA 43/25/0

## 5. Multi-Source Intelligence Layer (this milestone)

`/app/artifacts/api-server/src/lib/intelligence/`:

| File                            | Role                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| `types.ts`                      | `SourceType`, `DiscoveredItem`, `DiscoveryReport`, section-mapping|
| `connectors/google-news.ts`     | Google News RSS parser + materiality scoring (no API key)         |
| `connectors/bse-announcements.ts`| BSE Corporate Announcements API + subtype classification         |
| `persister.ts`                  | Writes to existing `news` + `documents` tables with dedupe        |
| `discovery.ts`                  | Orchestrator — parallel connectors → dedupe → persist             |
| `read.ts`                       | Unified read API grouped by source_type                           |
| `scheduler.ts`                  | In-process daily + weekly loops (enabled via env)                 |

Routes (`/api/intelligence/…`):
- `GET  /status` — scheduler status
- `GET  /:ticker` — full intelligence stream for a company
- `POST /:ticker/discover` — trigger a fresh discovery
- `POST /onboard` — insert a company + run initial discovery

Frontend `/app/frontend/src/pages/intelligence.tsx`:
- Tabs & filter chips per source type (Annual, Concall, Rating, Filing, IR Deck, News)
- Item cards with source badge, date, publisher, "View source" outbound link
- "Discover latest" button triggers on-demand refresh
- Cross-links to `/live-report/:ticker`

Scheduler defaults: daily = news (3d) + filings (21d); weekly deep = 30d news + 365d filings. Turn on with `STOCKLENS_SCHEDULER=on`.

## 6. Test evidence

**Reliance** (auto-discovered):
- 1 annual report (existing, preserved · unchanged)
- 16 filings from BSE (Q1FY27 results, Reg 30 disclosures, Institutional Investor meets)
- 1 credit rating
- 1 investor presentation
- 10 news headlines (₹2.73 lakh crore coal-gas investment, RCom chargesheet, brand-marketing appointment, index moves)

**TCS** (onboarded during this run):
- 15 filings from BSE
- 1 concall transcript
- 1 credit rating
- 24 news headlines

## 7. Preservation guarantees

- Existing 30-section multi-agent report at `/live-report/RELIANCE` continues to render (91,663 chars, verified live).
- Existing Reliance annual report row and its 283 document chunks in Supabase are untouched.
- No new tables — reused `documents` + `news` + `companies` + `research` + `research_jobs`.

## 8. Backlog / next actions

- P1: Auto-download referenced PDFs (concall, credit rating, IR deck) → chunk → embed → make available to specialist retrieval so the research engine actually consumes concall transcripts and rating rationales.
- P1: Wire an "event-driven research refresh" that re-runs only affected specialist sections when a new material filing arrives.
- P2: Build the "onboard a new company" UI (search box on Home) — currently onboarding is via `POST /api/intelligence/onboard`.
- P2: Add NSE filings connector as a fallback for BSE-only firms.
- P3: Push discovery events to a queue table (`filing_queue`) so external workers can subscribe.

## 9. Credentials

See `/app/memory/test_credentials.md`.
