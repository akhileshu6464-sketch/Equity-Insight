/**
 * BSE India Corporate Announcements connector.
 *
 * Uses the public BSE Corporate Announcements API — no key required.
 * We honour BSE's public feed (used by their own website widgets).
 *
 * Docs (informal): https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w
 *
 * We treat every announcement as an event of source_type="filing". Where a
 * PDF is attached, we save its URL in `document_url` so investors can click
 * through to the primary source.
 */

import crypto from "node:crypto";
import { logger } from "../../logger.js";
import type { DiscoveredItem } from "../types.js";

interface BseAnnouncement {
  NEWSID: string;
  SCRIP_CD: number;
  XML_NAME: string;
  NEWSSUB: string;              // Subject / headline
  DT_TM: string;                // ISO-ish timestamp
  NEWS_DT: string;              // Filing date
  CATEGORYNAME?: string;
  SUBCATNAME?: string;
  HEADLINE?: string;
  MORE?: string;
  ATTACHMENTNAME?: string;      // Sometimes attachment file name
  PDFFLAG?: string;
}

interface BseResponse {
  Table: BseAnnouncement[];
}

function toYyyymmdd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function hashItem(url: string, title: string): string {
  return crypto
    .createHash("sha256")
    .update(url + "::" + title.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 32);
}

function inferFinancialContext(headline: string): { quarter?: string; financialYear?: string } {
  const q = headline.match(/Q([1-4])\s?FY?\s?(\d{2,4})/i);
  const fy = headline.match(/FY\s?(\d{2,4})[-/]?(\d{2,4})?/i);
  const out: { quarter?: string; financialYear?: string } = {};
  if (q) out.quarter = `Q${q[1]}FY${q[2]!.slice(-2)}`;
  if (fy) {
    const start = fy[1]!;
    const end = fy[2] ?? "";
    out.financialYear = end ? `FY${start.slice(-2)}-${end.slice(-2)}` : `FY${start.slice(-2)}`;
  }
  return out;
}

const PDF_BASE = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/";
const ANN_PATH_BASE = "https://www.bseindia.com/xml-data/corpfiling/AttachLive/";

function buildPdfUrl(item: BseAnnouncement): string | undefined {
  const name = item.ATTACHMENTNAME?.trim();
  if (!name) return undefined;
  // BSE serves attachments under /AttachHis or /AttachLive
  return `${PDF_BASE}${name}`;
}

function buildAnnouncementPageUrl(item: BseAnnouncement): string {
  // BSE's own detail page URL for the announcement
  return `https://www.bseindia.com/corporates/anndet_new.aspx?newsid=${encodeURIComponent(item.NEWSID)}`;
}

const RELEVANT_CATEGORIES: Set<string> = new Set([
  "Result", "Financial Results", "Quarterly Results",
  "Investor Presentation",
  "Corporate Action",
  "Board Meeting",
  "Acquisition", "Amalgamation / Merger",
  "Change in Directors / KMP",
  "Credit Rating",
  "Loss/Duplicate", "New Certificate",
  "Regulation 30 (LODR)",
  "Postal Ballot", "General Updates",
  "Fund Raising",
]);

function isMaterial(cat: string | undefined, subject: string): boolean {
  if (cat && [...RELEVANT_CATEGORIES].some((c) => cat.includes(c))) return true;
  const s = subject.toLowerCase();
  return (
    s.includes("acquisition") ||
    s.includes("rating") ||
    s.includes("results") ||
    s.includes("investor presentation") ||
    s.includes("earnings") ||
    s.includes("conference call") ||
    s.includes("earnings call") ||
    s.includes("transcript") ||
    s.includes("audio") ||
    s.includes("director") ||
    s.includes("resignation") ||
    s.includes("appointment") ||
    s.includes("dividend") ||
    s.includes("buyback") ||
    s.includes("regulation 30") ||
    s.includes("regulation 46") ||
    s.includes("capex") ||
    s.includes("expansion") ||
    s.includes("scheme")
  );
}

/**
 * Classify a BSE announcement into one of our SourceType buckets.
 * If the subject signals a concall transcript / IR presentation, we upgrade
 * the source_type so the specialists get the richest possible context.
 */
export function classifyBseAnnouncement(subject: string, category?: string):
  | "concall"
  | "investor_presentation"
  | "credit_rating"
  | "filing" {
  const s = subject.toLowerCase();
  if (s.includes("earnings call transcript") || s.includes("concall transcript") ||
      s.includes("conference call transcript") || s.includes("investor conference call transcript")) {
    return "concall";
  }
  if (s.includes("investor presentation") || s.includes("earnings presentation")) {
    return "investor_presentation";
  }
  if (s.includes("credit rating") || (category && category.toLowerCase().includes("credit rating"))) {
    return "credit_rating";
  }
  return "filing";
}

export interface BseDiscoveryOptions {
  companyId: string;
  bseScripCode: string;      // e.g. "500325" for Reliance
  companyName: string;
  daysBack?: number;         // Default 365
  maxItems?: number;         // Default 60
}

export async function discoverBseAnnouncements(
  opts: BseDiscoveryOptions,
): Promise<DiscoveredItem[]> {
  const { companyId, bseScripCode, companyName, daysBack = 365, maxItems = 60 } = opts;
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const url =
    `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?` +
    `pageno=1&strCat=-1&strPrevDate=${toYyyymmdd(from)}` +
    `&strScrip=${encodeURIComponent(bseScripCode)}&strSearch=P` +
    `&strToDate=${toYyyymmdd(to)}&strType=C&subcategory=-1`;

  let body: BseResponse;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.bseindia.com/",
        Origin: "https://www.bseindia.com",
        "sec-ch-ua": '"Not(A:Brand";v="99", "Google Chrome";v="122"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
      },
    });
    if (!response.ok) {
      logger.warn({ url, status: response.status }, "BSE announcements non-200");
      return [];
    }
    const text = await response.text();
    if (
      text.trim() === '"No Record Found!"' ||
      text.trim() === "" ||
      text.startsWith("<")
    ) {
      logger.warn({ status: response.status, sample: text.slice(0, 80) }, "BSE returned no data / blocked");
      return [];
    }
    body = JSON.parse(text) as BseResponse;
  } catch (err) {
    logger.error({ err }, "BSE announcements fetch failed");
    return [];
  }

  const rows = Array.isArray(body.Table) ? body.Table : [];
  const out: DiscoveredItem[] = [];
  for (const row of rows.slice(0, maxItems)) {
    const subject = (row.NEWSSUB ?? row.HEADLINE ?? "").trim();
    if (!subject) continue;
    if (!isMaterial(row.CATEGORYNAME, subject)) continue;

    const detailUrl = buildAnnouncementPageUrl(row);
    const pdfUrl = buildPdfUrl(row);
    const sourceType = classifyBseAnnouncement(subject, row.CATEGORYNAME);
    const dt = row.DT_TM || row.NEWS_DT;
    const isoDate = dt ? new Date(dt).toISOString() : undefined;

    out.push({
      companyId,
      sourceType,
      title: subject,
      headline: subject,
      summary: [row.CATEGORYNAME, row.SUBCATNAME, row.MORE].filter(Boolean).join(" · "),
      publicationDate: isoDate,
      publisher: "BSE India",
      originalUrl: detailUrl,
      documentUrl: pdfUrl,
      ...inferFinancialContext(subject),
      contentHash: hashItem(detailUrl, subject),
      metadata: {
        bseNewsId: row.NEWSID,
        scripCode: row.SCRIP_CD,
        category: row.CATEGORYNAME,
        subCategory: row.SUBCATNAME,
        companyName,
      },
    });
  }
  return out;
}
