import { Router, type IRouter } from "express";
import { openai } from "../lib/openai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

export default router;
