/**
 * Read API for the Company Intelligence page.
 *
 * Returns the latest items for a company grouped by source type. Also
 * returns discovery status for admin visibility.
 */

import { supabaseRest } from "../research/supabase-rest.js";
import type { SourceType } from "./types.js";

interface NewsRow {
  id: string;
  headline: string;
  summary: string | null;
  source_name: string | null;
  source_url: string | null;
  published_at: string | null;
  category: string | null;
  relevance_score: number | null;
}

interface DocumentRow {
  id: string;
  title: string;
  document_type: string | null;
  document_date: string | null;
  publication_date: string | null;
  reporting_period: string | null;
  source_name: string | null;
  source_url: string | null;
  document_url: string | null;
  text_extraction_status: string | null;
  processing_status: string | null;
  created_at: string;
}

export interface IntelligenceItem {
  id: string;
  sourceType: SourceType;
  title: string;
  summary?: string | null;
  publishedAt?: string | null;
  publisher?: string | null;
  category?: string | null;
  originalUrl?: string | null;
  documentUrl?: string | null;
  quarter?: string | null;
  financialYear?: string | null;
  status?: string | null;
  relevanceScore?: number | null;
}

export interface CompanyIntelligence {
  company: {
    id: string;
    ticker: string;
    name: string;
  };
  counts: Record<SourceType, number>;
  items: IntelligenceItem[];
}

interface CompanyRow {
  id: string;
  ticker: string;
  name: string;
}

export async function getCompanyIntelligence(ticker: string): Promise<CompanyIntelligence | null> {
  const t = ticker.toUpperCase().trim();
  const companies = await supabaseRest<CompanyRow[]>(
    "GET",
    `/companies?ticker=eq.${encodeURIComponent(t)}&select=id,ticker,name`,
  );
  const company = companies[0];
  if (!company) return null;

  const [newsRows, docRows] = await Promise.all([
    supabaseRest<NewsRow[]>(
      "GET",
      `/news?company_id=eq.${encodeURIComponent(company.id)}` +
      `&select=id,headline,summary,source_name,source_url,published_at,category,relevance_score` +
      `&order=published_at.desc.nullslast&limit=200`,
    ),
    supabaseRest<DocumentRow[]>(
      "GET",
      `/documents?company_id=eq.${encodeURIComponent(company.id)}` +
      `&select=id,title,document_type,document_date,publication_date,reporting_period,source_name,source_url,document_url,text_extraction_status,processing_status,created_at` +
      `&order=publication_date.desc.nullslast&limit=400`,
    ),
  ]);

  const items: IntelligenceItem[] = [];
  const counts: Record<SourceType, number> = {
    annual_report: 0, concall: 0, credit_rating: 0,
    filing: 0, investor_presentation: 0, news: 0,
  };

  for (const r of newsRows) {
    items.push({
      id: r.id,
      sourceType: "news",
      title: r.headline,
      summary: r.summary,
      publishedAt: r.published_at,
      publisher: r.source_name,
      category: r.category,
      originalUrl: r.source_url,
      relevanceScore: r.relevance_score,
    });
    counts.news += 1;
  }

  const known: SourceType[] = ["annual_report", "concall", "credit_rating", "filing", "investor_presentation"];
  for (const r of docRows) {
    const type = (r.document_type ?? "").toLowerCase();
    const st: SourceType = known.includes(type as SourceType) ? (type as SourceType) : "filing";
    items.push({
      id: r.id,
      sourceType: st,
      title: r.title,
      summary: null,
      publishedAt: r.publication_date ?? r.document_date ?? r.created_at,
      publisher: r.source_name,
      category: r.document_type,
      originalUrl: r.source_url,
      documentUrl: r.document_url,
      quarter: r.reporting_period,
      financialYear: r.reporting_period,
      status: r.processing_status ?? r.text_extraction_status,
    });
    counts[st] += 1;
  }

  items.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  return { company, counts, items };
}
