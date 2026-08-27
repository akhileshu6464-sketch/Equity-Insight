/**
 * Persist DiscoveredItem[] into Supabase with dedupe.
 *
 * • sourceType = "news"       → `news` table
 * • all other source types    → `documents` table (with document_type = sourceType)
 *
 * Deduplication:
 *   • news: dedupe by source_url + headline (via contentHash lookup in metadata)
 *   • documents: dedupe by document_url OR source_url + title
 *
 * We NEVER re-ingest an already-stored item.
 */

import { logger } from "../logger.js";
import { supabaseRest } from "../research/supabase-rest.js";
import type { DiscoveredItem, SourceType } from "./types.js";

interface NewsRow {
  id: string;
  headline: string;
  source_url: string | null;
  published_at: string | null;
}

interface DocumentRow {
  id: string;
  title: string;
  document_url: string | null;
  source_url: string | null;
  document_type: string | null;
}

interface PersistOutcome {
  stored: number;
  skippedDuplicate: number;
  errors: string[];
}

async function existingNewsUrls(companyId: string): Promise<Set<string>> {
  const rows = await supabaseRest<NewsRow[]>(
    "GET",
    `/news?company_id=eq.${encodeURIComponent(companyId)}&select=id,source_url,headline&limit=2000`,
  );
  const set = new Set<string>();
  for (const r of rows) {
    if (r.source_url) set.add(r.source_url);
    if (r.headline) set.add(r.headline.toLowerCase().replace(/\s+/g, " ").trim());
  }
  return set;
}

async function existingDocuments(companyId: string): Promise<Set<string>> {
  const rows = await supabaseRest<DocumentRow[]>(
    "GET",
    `/documents?company_id=eq.${encodeURIComponent(companyId)}&select=id,title,document_url,source_url,document_type&limit=2000`,
  );
  const set = new Set<string>();
  for (const r of rows) {
    if (r.document_url) set.add(r.document_url);
    if (r.source_url) set.add(r.source_url);
    if (r.title) set.add(r.title.toLowerCase().replace(/\s+/g, " ").trim());
  }
  return set;
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

function newsCategoryFrom(item: DiscoveredItem): string {
  const t = item.title.toLowerCase();
  if (t.includes("acquisition") || t.includes("merger")) return "M&A";
  if (t.includes("rating")) return "Credit";
  if (t.includes("result") || t.includes("earnings")) return "Results";
  if (t.includes("order") || t.includes("contract")) return "Business";
  if (t.includes("regulator") || t.includes("sebi")) return "Regulatory";
  if (t.includes("dividend") || t.includes("buyback")) return "Capital Returns";
  if (t.includes("appoint") || t.includes("resign")) return "Management";
  return "General";
}

async function insertNewsItem(item: DiscoveredItem): Promise<boolean> {
  await supabaseRest("POST", "/news", {
    prefer: "return=minimal",
    body: {
      company_id: item.companyId,
      headline: item.headline ?? item.title,
      summary: item.summary ?? null,
      source_name: item.publisher ?? "Auto-discovered",
      source_url: item.originalUrl,
      published_at: item.publicationDate ?? new Date().toISOString(),
      category: newsCategoryFrom(item),
      is_processed: false,
      relevance_score:
        typeof item.metadata?.materialityScore === "number"
          ? (item.metadata.materialityScore as number)
          : null,
      materiality: null,
    },
  });
  return true;
}

async function insertDocument(item: DiscoveredItem): Promise<boolean> {
  const period = item.financialYear ?? item.quarter ?? null;
  await supabaseRest("POST", "/documents", {
    prefer: "return=minimal",
    body: {
      company_id: item.companyId,
      title: item.title,
      document_type: item.sourceType,
      document_date: item.publicationDate?.slice(0, 10) ?? null,
      publication_date: item.publicationDate?.slice(0, 10) ?? null,
      reporting_period: period,
      source_name: item.publisher ?? null,
      source_url: item.originalUrl,
      document_url: item.documentUrl ?? null,
      // Content will be extracted by a future step when we auto-download PDFs.
      // Use existing allowed status enums.
      content: null,
      text_extraction_status: "pending",
      processing_status: "unprocessed",
      source_tier: item.sourceType === "annual_report" ? 1 : 2,
    },
  });
  return true;
}

export async function persistDiscoveredItems(
  companyId: string,
  items: DiscoveredItem[],
): Promise<Record<SourceType, PersistOutcome>> {
  // Pull dedupe sets once
  const [newsSet, docSet] = await Promise.all([
    existingNewsUrls(companyId),
    existingDocuments(companyId),
  ]);

  const outcome: Record<SourceType, PersistOutcome> = {
    annual_report: { stored: 0, skippedDuplicate: 0, errors: [] },
    concall: { stored: 0, skippedDuplicate: 0, errors: [] },
    credit_rating: { stored: 0, skippedDuplicate: 0, errors: [] },
    filing: { stored: 0, skippedDuplicate: 0, errors: [] },
    investor_presentation: { stored: 0, skippedDuplicate: 0, errors: [] },
    news: { stored: 0, skippedDuplicate: 0, errors: [] },
  };

  for (const item of items) {
    try {
      if (item.sourceType === "news") {
        const dedupeKey1 = item.originalUrl;
        const dedupeKey2 = normalizeTitle(item.headline ?? item.title);
        if (newsSet.has(dedupeKey1) || newsSet.has(dedupeKey2)) {
          outcome.news.skippedDuplicate += 1;
          continue;
        }
        await insertNewsItem(item);
        newsSet.add(dedupeKey1);
        newsSet.add(dedupeKey2);
        outcome.news.stored += 1;
      } else {
        const dedupeKey1 = item.documentUrl ?? item.originalUrl;
        const dedupeKey2 = normalizeTitle(item.title);
        if (docSet.has(dedupeKey1) || docSet.has(dedupeKey2)) {
          outcome[item.sourceType].skippedDuplicate += 1;
          continue;
        }
        await insertDocument(item);
        docSet.add(dedupeKey1);
        docSet.add(dedupeKey2);
        outcome[item.sourceType].stored += 1;
      }
    } catch (err) {
      logger.error({ err, sourceType: item.sourceType, title: item.title }, "Persist failed");
      outcome[item.sourceType].errors.push(String(err));
    }
  }

  return outcome;
}
