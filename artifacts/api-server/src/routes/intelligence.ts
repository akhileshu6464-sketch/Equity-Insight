import { Router, type IRouter } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { discoverForCompany, findCompanyByTicker } from "../lib/intelligence/discovery.js";
import { getCompanyIntelligence } from "../lib/intelligence/read.js";
import { schedulerStatus, startScheduler } from "../lib/intelligence/scheduler.js";
import { supabaseRest } from "../lib/research/supabase-rest.js";

const router: IRouter = Router();

const TickerParam = z.object({ ticker: z.string().min(1).max(24) });
const OnboardBody = z.object({
  ticker: z.string().min(1).max(24),
  name: z.string().min(1).max(200).optional(),
  bseScripCode: z.string().min(1).max(20).optional(),
  isin: z.string().min(1).max(20).optional(),
});

/**
 * GET /api/intelligence/status
 * Scheduler status and whether the scheduler is enabled.
 * (Defined BEFORE the parameterized route so it doesn't match :ticker.)
 */
router.get("/intelligence/status", (_req, res) => {
  res.json(schedulerStatus());
});

/**
 * POST /api/intelligence/onboard
 * Onboard a new company: insert into `companies` (if not present) then
 * discover initial sources.
 */
router.post("/intelligence/onboard", async (req, res) => {
  const parsed = OnboardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ticker (and optionally name) is required." });
    return;
  }
  const { ticker, name, bseScripCode, isin } = parsed.data;
  try {
    let company = await findCompanyByTicker(ticker);
    if (!company) {
      if (!name) {
        res.status(400).json({ error: "Company not in database — provide `name` to onboard." });
        return;
      }
      const inserted = await supabaseRest<Array<{ id: string; ticker: string; name: string }>>(
        "POST",
        "/companies",
        {
          prefer: "return=representation",
          body: {
            ticker: ticker.toUpperCase(),
            name,
            exchange: "BSE",
            sector: "Unclassified",
            industry: "Unclassified",
            short_description: `${name} — auto-onboarded by StockLens.`,
            isin: isin ?? null,
            is_active: true,
          },
        },
      );
      company = { id: inserted[0]!.id, ticker: inserted[0]!.ticker, name: inserted[0]!.name };
    }
    // Kick off discovery
    const report = await discoverForCompany(company.ticker, {
      daysBackNews: 30,
      daysBackFilings: 365,
    });
    res.json({ company, report, bseScripCodeUsed: bseScripCode ?? null });
  } catch (err) {
    logger.error({ err }, "Onboarding failed");
    res.status(502).json({ error: "Onboarding failed", detail: String(err) });
  }
});

/**
 * GET /api/intelligence/:ticker
 * Returns news + filings + concalls + ratings + IR decks for a company.
 */
router.get("/intelligence/:ticker", async (req, res) => {
  const parsed = TickerParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Ticker is required." });
    return;
  }
  try {
    const data = await getCompanyIntelligence(parsed.data.ticker);
    if (!data) {
      res.status(404).json({ error: "Company not found." });
      return;
    }
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Intelligence read failed");
    res.status(503).json({ error: "The intelligence database is unavailable." });
  }
});

/**
 * POST /api/intelligence/:ticker/discover
 * Trigger a fresh discovery run for a company. Returns per-source counts.
 */
router.post("/intelligence/:ticker/discover", async (req, res) => {
  const parsed = TickerParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Ticker is required." });
    return;
  }
  try {
    const daysBackNews = Number(req.body?.daysBackNews ?? 21);
    const daysBackFilings = Number(req.body?.daysBackFilings ?? 365);
    const report = await discoverForCompany(parsed.data.ticker, {
      daysBackNews: Number.isFinite(daysBackNews) ? daysBackNews : 21,
      daysBackFilings: Number.isFinite(daysBackFilings) ? daysBackFilings : 365,
    });
    res.json(report);
  } catch (err) {
    logger.error({ err, ticker: req.params.ticker }, "Discovery run failed");
    res.status(502).json({ error: "Discovery run failed", detail: String(err) });
  }
});

// Boot the scheduler once when the router is imported.
startScheduler();

export default router;
