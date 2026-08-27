/**
 * In-process scheduler.
 *
 * Runs periodic discovery for all known companies. Uses setInterval — this
 * survives as long as the Node process is up. The FastAPI proxy manages the
 * Node child, so the scheduler runs whenever the backend is up.
 *
 * Frequencies (deterministic, cheap):
 *   • daily    → news + filings          (only fresh window, dedupe on write)
 *   • weekly   → filings deep sweep (365-day window)
 *
 * Intervals are DISABLED by default. Enable via env STOCKLENS_SCHEDULER=on.
 */

import { logger } from "../logger.js";
import { supabaseRest } from "../research/supabase-rest.js";
import { discoverForCompany } from "./discovery.js";

const ENABLED = process.env.STOCKLENS_SCHEDULER === "on";
const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * DAILY_MS;

interface CompanyRow {
  id: string;
  ticker: string;
  name: string;
  is_active: boolean | null;
}

let dailyHandle: NodeJS.Timeout | null = null;
let weeklyHandle: NodeJS.Timeout | null = null;
let lastDailyRun: string | null = null;
let lastWeeklyRun: string | null = null;

async function listActiveCompanies(): Promise<CompanyRow[]> {
  const rows = await supabaseRest<CompanyRow[]>(
    "GET",
    `/companies?select=id,ticker,name,is_active&is_active=eq.true&limit=1000`,
  );
  return rows;
}

async function runDaily() {
  lastDailyRun = new Date().toISOString();
  try {
    const companies = await listActiveCompanies();
    logger.info({ count: companies.length }, "Scheduler daily run starting");
    // Sequential to avoid hammering upstream sources.
    for (const c of companies) {
      try {
        const report = await discoverForCompany(c.ticker, {
          daysBackNews: 3,
          daysBackFilings: 21,
          enableNews: true,
          enableFilings: true,
        });
        logger.info(
          { ticker: c.ticker, stored: report.totalStored },
          "Scheduler daily company complete",
        );
      } catch (err) {
        logger.error({ err, ticker: c.ticker }, "Scheduler daily company failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Scheduler daily run failed");
  }
}

async function runWeekly() {
  lastWeeklyRun = new Date().toISOString();
  try {
    const companies = await listActiveCompanies();
    logger.info({ count: companies.length }, "Scheduler weekly deep sweep");
    for (const c of companies) {
      try {
        await discoverForCompany(c.ticker, {
          daysBackNews: 30,
          daysBackFilings: 365,
        });
      } catch (err) {
        logger.error({ err, ticker: c.ticker }, "Scheduler weekly company failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Scheduler weekly run failed");
  }
}

export function startScheduler() {
  if (!ENABLED) {
    logger.info("Scheduler disabled (set STOCKLENS_SCHEDULER=on to enable)");
    return;
  }
  if (dailyHandle) return;
  logger.info("Scheduler enabled — starting daily + weekly loops");

  // Fire the first daily run 60s after boot (avoid startup congestion).
  dailyHandle = setTimeout(async () => {
    await runDaily();
    dailyHandle = setInterval(runDaily, DAILY_MS);
  }, 60_000);

  weeklyHandle = setTimeout(async () => {
    await runWeekly();
    weeklyHandle = setInterval(runWeekly, WEEKLY_MS);
  }, 5 * 60_000);
}

export function stopScheduler() {
  if (dailyHandle) clearTimeout(dailyHandle as NodeJS.Timeout);
  if (weeklyHandle) clearTimeout(weeklyHandle as NodeJS.Timeout);
  dailyHandle = null;
  weeklyHandle = null;
}

export function schedulerStatus() {
  return {
    enabled: ENABLED,
    running: dailyHandle !== null,
    lastDailyRun,
    lastWeeklyRun,
  };
}
