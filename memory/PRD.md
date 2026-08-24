# StockLens — Product Requirements & Build Log

## 1. Original problem statement

Implement the multi-agent equity-research engine for StockLens (cloned from
`akhileshu6464-sketch/Equity-Insight`). The existing single-agent
`annual-report-generator.ts` produces shallow summaries — replace it with a
Master + 7 Specialists + QA/Validator architecture while preserving the
existing checklist, Supabase ingestion/retrieval, evidence system, and UI.

## 2. Live URLs

- **Preview**: `https://market-view-19.preview.emergentagent.com/`
- **Sample static report**: `/research/reliance-industries`
- **Multi-agent live report**: `/live-report/RELIANCE`
- **Backend proxy**: `/api/*` (FastAPI on :8001 → Express on :8002)

## 3. Architecture

```
┌────────────────────┐        ┌───────────────────────────────────────┐
│ React (Vite) 3000  │ ─────▶ │ FastAPI 8001  ─── proxy ──▶ Node 8002 │
└────────────────────┘        │           (spawns child)  Express     │
                              └───────────────────────────────────────┘
                                                │
                                                ▼
                                    ┌──────────────────────┐
                                    │ Supabase REST + LLM  │
                                    │ (OpenAI gpt-4o-mini) │
                                    └──────────────────────┘
```

- `/app/backend/server.py` — FastAPI proxy that spawns the Node backend and
  forwards every `/api/*` request. Required to satisfy supervisor's fixed
  `uvicorn` command.
- `/app/artifacts/api-server` — Express + TS backend (original).
- `/app/artifacts/api-server/src/lib/research/agents/` — **NEW** multi-agent code.
- `/app/frontend` — Vite React app (added `LiveReport` page).

## 4. Multi-agent implementation

Located in `/app/artifacts/api-server/src/lib/research/agents/`:

| File                    | Role                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `types.ts`              | Shared types (`SpecialistFinding`, `MasterSynthesis`, `QAReport`)         |
| `calculator.ts`         | Deterministic arithmetic (YoY, CAGR, margins, receivable/inventory days) |
| `specialist-base.ts`    | LLM caller w/ 429-aware retry + evidence grounding + citation validation |
| `specialists.ts`        | 7 specialist definitions (business, financial, cash/BS, mgmt, RPT, audit, risks) |
| `validator.ts`          | Deterministic QA validator (numerics, basis, period, contradictions)     |
| `master.ts`             | Orchestrator + parallel dispatch + section synthesis                     |
| `persistence.ts`        | Writes `research` (30 sections) + `analysis_evidence` to Supabase        |
| `engine.ts`             | `runRelianceMultiAgentResearch()` entrypoint                             |

New route: `POST /api/ai/research/multi-agent` (auth via `x-stocklens-research-key`).

## 5. Model / knob defaults

- `STOCKLENS_SPECIALIST_MODEL` = `gpt-4o-mini` (higher TPM)
- `STOCKLENS_MASTER_MODEL` = `gpt-4o-mini`
- `STOCKLENS_SPECIALIST_CONCURRENCY` = `2`
- Section synthesis parallelism = 2

## 6. Reliance test run — result

- Total findings: **68**  (supported: **64**)
- QA passed: **43** / failed: **25**  (contradictions: **0**)
- Sections persisted: **30** (`research` table replaced end-to-end)
- Runtime: ~5m 22s

## 7. Backlog / next actions

- P1: Loosen numeric grounding to handle Indian formatting variants (`₹4,99,270 crore` vs `499270`) — will lift many findings from `UNCERTAIN` to `FACT`.
- P1: Add company search UI on Home so any ingested company can be researched (currently locked to RELIANCE).
- P2: Stream progress (SSE) from `/api/ai/research/multi-agent` so users see phase transitions live.
- P2: Add specialist unit tests using recorded fixtures instead of live LLM.
- P2: Cache specialist findings by question hash so a re-run only recomputes changed questions.

## 8. Credentials

See `/app/memory/test_credentials.md`.
