/**
 * Google News RSS connector.
 *
 * Uses the publicly available RSS feed (no API key). We honour the feed's
 * terms — we do NOT scrape article bodies, only display Google-provided
 * headline + source + URL. Investors click through for full articles.
 *
 * Feed: https://news.google.com/rss/search?q=<query>&hl=en-IN&gl=IN&ceid=IN:en
 */

import crypto from "node:crypto";
import { logger } from "../../logger.js";
import type { DiscoveredItem } from "../types.js";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? decodeXmlEntities(m[1]!).trim() : null;
}

interface ParsedNewsItem {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string;
  summary: string;
}

function parseRssItems(xml: string): ParsedNewsItem[] {
  const items: ParsedNewsItem[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const body = m[1]!;
    const title = extractTag(body, "title") ?? "";
    const link = extractTag(body, "link") ?? "";
    const publisher = extractTag(body, "source") ?? "";
    const publishedAt = extractTag(body, "pubDate") ?? "";
    const description = extractTag(body, "description") ?? "";
    if (!title || !link) continue;
    items.push({
      title,
      link,
      publisher,
      publishedAt,
      summary: stripHtml(description),
    });
  }
  return items;
}

function normalizeIsoDate(rfc822: string): string | undefined {
  if (!rfc822) return undefined;
  const dt = new Date(rfc822);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
}

/** Compute a stable hash for dedupe: url is enough (unique per Google news_id). */
function hashItem(link: string, title: string): string {
  return crypto
    .createHash("sha256")
    .update(link + "::" + title.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 32);
}

const RELEVANT_KEYWORDS = [
  "acquisition", "acquires", "acquire", "merger", "buys",
  "order", "contract", "capex", "expansion", "invest",
  "results", "profit", "revenue", "earnings", "loss",
  "rating", "downgrade", "upgrade", "outlook",
  "regulator", "regulatory", "penalty", "fine", "sebi",
  "board", "management", "resignation", "appoint",
  "fundraising", "bonds", "loan", "refinanc",
  "capacity", "plant", "launch", "listing", "ipo",
  "buyback", "dividend", "split", "bonus",
  "chairman", "ceo", "cfo",
];

/**
 * Materiality heuristic (0..1). Higher = more likely material to research.
 * Deterministic — no LLM needed at discovery time.
 */
function scoreMateriality(title: string, summary: string): number {
  const lower = (title + " " + summary).toLowerCase();
  let score = 0.1;
  for (const kw of RELEVANT_KEYWORDS) {
    if (lower.includes(kw)) score += 0.08;
  }
  if (/₹\s?[\d,]{4,}/.test(lower)) score += 0.1;
  if (/\bcrore\b|\bbillion\b|\bmillion\b/.test(lower)) score += 0.06;
  return Math.min(1, score);
}

export interface GoogleNewsQueryOptions {
  companyId: string;
  companyName: string;
  aliases?: string[];       // Additional search terms (e.g. "Reliance Industries", "RIL")
  maxItems?: number;        // Default 40
  minMateriality?: number;  // Default 0.18
}

export async function discoverGoogleNewsRss(
  opts: GoogleNewsQueryOptions,
): Promise<DiscoveredItem[]> {
  const { companyId, companyName, aliases = [], maxItems = 40, minMateriality = 0.18 } = opts;
  const searchTerms = [companyName, ...aliases]
    .map((t) => `"${t}"`)
    .join(" OR ");
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(searchTerms)}&hl=en-IN&gl=IN&ceid=IN:en`;

  let xml: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 StockLensBot (+https://stocklens.dev)",
        Accept: "application/rss+xml, application/xml",
      },
    });
    if (!response.ok) {
      logger.warn({ url, status: response.status }, "Google News RSS non-200");
      return [];
    }
    xml = await response.text();
  } catch (err) {
    logger.error({ err, url }, "Google News RSS fetch failed");
    return [];
  }

  const items = parseRssItems(xml).slice(0, maxItems);
  const out: DiscoveredItem[] = [];
  for (const it of items) {
    const material = scoreMateriality(it.title, it.summary);
    if (material < minMateriality) continue;
    out.push({
      companyId,
      sourceType: "news",
      title: it.title,
      headline: it.title,
      summary: it.summary || undefined,
      publicationDate: normalizeIsoDate(it.publishedAt),
      publisher: it.publisher || "Google News",
      originalUrl: it.link,
      contentHash: hashItem(it.link, it.title),
      metadata: { materialityScore: material },
    });
  }
  return out;
}
