# StockLens — Test Credentials & Env

## Supabase (existing DB with ingested Reliance annual report)

- `SUPABASE_URL` = https://wnfjdajjhdbuvnpqzfjk.supabase.co
- `SUPABASE_SECRET_KEY` = provided by user (in `/app/artifacts/api-server/.env`)

## Reliance test dataset (already ingested)

- Company ID: `11111111-1111-4111-8111-111111111111`
- Document ID: `77d948bd-ff1f-4f62-9355-db70188f7183`
- Document: Reliance Industries FY2025-26 Annual Report (283 chunks, 187 pages)

## OpenAI

- `OPENAI_API_KEY` = provided by user (in `/app/artifacts/api-server/.env`)
- Specialist model: `gpt-4o-mini`
- Master model: `gpt-4o-mini`

## Internal research trigger

- Header: `x-stocklens-research-key`
- Value (`SESSION_SECRET`): `stocklens-research-2026-multi-agent-master-key`

## Example — trigger multi-agent run

```
curl -X POST \
  https://market-view-19.preview.emergentagent.com/api/ai/research/multi-agent \
  -H "content-type: application/json" \
  -H "x-stocklens-research-key: stocklens-research-2026-multi-agent-master-key" \
  -d '{"documentId":"77d948bd-ff1f-4f62-9355-db70188f7183"}'
```

## Auth users

- No end-user authentication implemented (existing project has none).
