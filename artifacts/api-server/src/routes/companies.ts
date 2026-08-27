import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  getCompanyResearch,
  searchCompanies,
} from "../lib/supabase";

const SearchQuery = z.object({ search: z.string().min(1).max(100) });
const TickerParam = z.object({ ticker: z.string().min(1).max(24) });

const router: IRouter = Router();

router.get("/companies", async (req, res) => {
  const rawSearch = typeof req.query.search === "string" ? req.query.search.trim() : "";

  try {
    if (rawSearch.length === 0) {
      // Return all active companies so the frontend can present a directory.
      const parsed = SearchQuery.safeParse({ search: "%" });
      if (!parsed.success) {
        res.status(400).json({ error: "Search text is required." });
        return;
      }
      // supabase supports selecting all with limit — call directly
      const { supabaseRest } = await import("../lib/research/supabase-rest.js");
      const rows = await supabaseRest<
        Array<{
          id: string;
          name: string;
          ticker: string;
          exchange: string;
          short_description: string | null;
        }>
      >(
        "GET",
        "/companies?select=id,name,ticker,exchange,short_description&is_active=eq.true&order=name.asc&limit=200",
      );
      res.json(rows);
      return;
    }

    const parsed = SearchQuery.safeParse({ search: rawSearch });
    if (!parsed.success) {
      res.status(400).json({ error: "Search text is required." });
      return;
    }
    const data = await searchCompanies(parsed.data.search);
    res.json(data);
  } catch (error) {
    req.log.error({ err: error }, "Failed to search Supabase companies");
    res.status(503).json({ error: "The research database is unavailable." });
  }
});

router.get("/companies/:ticker/research", async (req, res) => {
  const parsed = TickerParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "A company ticker is required." });
    return;
  }

  try {
    const data = await getCompanyResearch(parsed.data.ticker);
    if (!data) {
      res.status(404).json({ error: "Company research was not found." });
      return;
    }
    res.json(data);
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Supabase company research");
    res.status(503).json({ error: "The research database is unavailable." });
  }
});

export default router;
