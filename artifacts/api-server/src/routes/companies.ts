import { Router, type IRouter } from "express";
import {
  GetCompanyResearchParams,
  GetCompanyResearchResponse,
  SearchCompaniesQueryParams,
  SearchCompaniesResponse,
} from "@workspace/api-zod";
import {
  getCompanyResearch,
  searchCompanies,
} from "../lib/supabase";

const router: IRouter = Router();

router.get("/companies", async (req, res) => {
  const parsed = SearchCompaniesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Search text is required." });
    return;
  }

  try {
    const data = SearchCompaniesResponse.parse(
      await searchCompanies(parsed.data.search),
    );
    res.json(data);
  } catch (error) {
    req.log.error({ err: error }, "Failed to search Supabase companies");
    res.status(503).json({ error: "The research database is unavailable." });
  }
});

router.get("/companies/:ticker/research", async (req, res) => {
  const parsed = GetCompanyResearchParams.safeParse(req.params);
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

    res.json(GetCompanyResearchResponse.parse(data));
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Supabase company research");
    res.status(503).json({ error: "The research database is unavailable." });
  }
});

export default router;
