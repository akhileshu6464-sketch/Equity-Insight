import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { openai } from "../lib/openai";
import { logger } from "../lib/logger";
import { runRelianceAnnualReportResearch } from "../lib/research/annual-report-engine.js";
import { runRelianceMultiAgentResearch } from "../lib/research/agents/engine.js";
import { RELIANCE_ANNUAL_REPORT_ID } from "../lib/research/annual-report-source.js";

const router: IRouter = Router();
let activeAnnualReportRun: Promise<
  Awaited<ReturnType<typeof runRelianceAnnualReportResearch>>
> | null = null;
let activeMultiAgentRun: Promise<
  Awaited<ReturnType<typeof runRelianceMultiAgentResearch>>
> | null = null;

function validResearchTrigger(token: string | undefined) {
  const expected = process.env.SESSION_SECRET;
  if (!expected || !token) return false;
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  return (
    expectedBuffer.length === tokenBuffer.length &&
    timingSafeEqual(expectedBuffer, tokenBuffer)
  );
}

/**
 * GET /api/ai/test — smoke test for the OpenAI connection.
 */
router.get("/ai/test", async (_req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content:
            "Reply with exactly one sentence confirming that the StockLens OpenAI connection is working.",
        },
      ],
      max_tokens: 64,
    });

    const text = completion.choices[0]?.message?.content ?? "(no response)";
    logger.info({ model: completion.model }, "OpenAI test succeeded");

    res.json({ ok: true, model: completion.model, response: text });
  } catch (err) {
    logger.error({ err }, "OpenAI test failed");
    res.status(502).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /api/ai/research/reliance-annual-report — legacy single-agent run.
 * Kept for backward compatibility.
 */
router.post("/ai/research/reliance-annual-report", async (req, res) => {
  if (!process.env.SESSION_SECRET) {
    logger.error("SESSION_SECRET is required for the research trigger");
    res.status(503).json({ error: "Research execution is not configured." });
    return;
  }
  if (!validResearchTrigger(req.get("x-stocklens-research-key"))) {
    res.status(401).json({ error: "Unauthorized research trigger." });
    return;
  }

  const documentId =
    typeof req.body?.documentId === "string" ? req.body.documentId : "";

  if (documentId !== RELIANCE_ANNUAL_REPORT_ID) {
    res.status(400).json({
      error: "This Phase 1 endpoint is locked to the verified Reliance annual report.",
      requiredDocumentId: RELIANCE_ANNUAL_REPORT_ID,
    });
    return;
  }

  if (activeAnnualReportRun) {
    res.status(409).json({
      error: "The Reliance annual-report research run is already in progress.",
    });
    return;
  }

  try {
    activeAnnualReportRun = runRelianceAnnualReportResearch();
    const result = await activeAnnualReportRun;
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Reliance annual-report endpoint failed");
    res.status(502).json({
      error: "Reliance annual-report research failed.",
      detail: String(error),
    });
  } finally {
    activeAnnualReportRun = null;
  }
});

/**
 * POST /api/ai/research/multi-agent — NEW multi-agent research run.
 * Executes 7 specialists in parallel → QA validator → Master synthesis.
 */
router.post("/ai/research/multi-agent", async (req, res) => {
  if (!process.env.SESSION_SECRET) {
    logger.error("SESSION_SECRET is required for the multi-agent trigger");
    res.status(503).json({ error: "Research execution is not configured." });
    return;
  }
  if (!validResearchTrigger(req.get("x-stocklens-research-key"))) {
    res.status(401).json({ error: "Unauthorized research trigger." });
    return;
  }

  const documentId =
    typeof req.body?.documentId === "string" ? req.body.documentId : "";

  if (documentId && documentId !== RELIANCE_ANNUAL_REPORT_ID) {
    res.status(400).json({
      error: "This endpoint currently runs only against the ingested Reliance annual report.",
      requiredDocumentId: RELIANCE_ANNUAL_REPORT_ID,
    });
    return;
  }

  if (activeMultiAgentRun) {
    res.status(409).json({
      error: "A multi-agent research run is already in progress.",
    });
    return;
  }

  try {
    activeMultiAgentRun = runRelianceMultiAgentResearch();
    const result = await activeMultiAgentRun;
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Multi-agent research failed");
    res.status(502).json({
      error: "Multi-agent research failed.",
      detail: String(error),
    });
  } finally {
    activeMultiAgentRun = null;
  }
});

/**
 * GET /api/ai/research/status — quick check on active runs.
 */
router.get("/ai/research/status", (_req, res) => {
  res.json({
    singleAgentActive: activeAnnualReportRun !== null,
    multiAgentActive: activeMultiAgentRun !== null,
  });
});

export default router;
