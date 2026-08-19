import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { openai } from "../lib/openai";
import { logger } from "../lib/logger";
import { runRelianceAnnualReportResearch } from "../lib/research/annual-report-engine.js";
import { RELIANCE_ANNUAL_REPORT_ID } from "../lib/research/annual-report-source.js";

const router: IRouter = Router();
let activeAnnualReportRun: Promise<
  Awaited<ReturnType<typeof runRelianceAnnualReportResearch>>
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
 * GET /api/ai/test
 * Server-side smoke test — sends a short prompt to OpenAI and returns the
 * response text. The OPENAI_API_KEY never leaves the server.
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

    res.json({
      ok: true,
      model: completion.model,
      response: text,
    });
  } catch (err) {
    logger.error({ err }, "OpenAI test failed");
    res.status(502).json({ ok: false, error: String(err) });
  }
});

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

export default router;
