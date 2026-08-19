import {
  selectFramework,
  type CrossCheckRule,
  type IndustryFramework,
  type ResearchCheck,
} from "../research-framework.js";
import { supabaseRest } from "./supabase-rest.js";

export const RELIANCE_COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const RELIANCE_ANNUAL_REPORT_ID = "77d948bd-ff1f-4f62-9355-db70188f7183";
export const RELIANCE_REPORTING_PERIOD = "FY2025-26";
export const EXPECTED_CHUNK_COUNT = 283;
export const EXPECTED_PAGE_COUNT = 187;

export const ANNUAL_REPORT_SECTION_KEYS = [
  "business",
  "segments",
  "financial",
  "financial_trends",
  "ratios",
  "cash_balance_sheet",
  "cash_flow",
  "balance_sheet",
  "receivables",
  "inventory",
  "payables",
  "working_capital",
  "debt",
  "management",
  "outlook",
  "industry",
  "related_parties",
  "governance",
  "shareholders",
  "subsidiaries",
  "risks",
  "positives",
] as const;

export type AnnualReportSectionKey = (typeof ANNUAL_REPORT_SECTION_KEYS)[number];

type CompanyRow = {
  id: string;
  name: string;
  ticker: string;
  sector: string;
  industry: string;
};

type DocumentRow = {
  id: string;
  company_id: string;
  title: string;
  document_type: string;
  reporting_period: string | null;
  publication_date: string | null;
  document_date: string | null;
  text_extraction_status: string;
  processing_status: string;
};

type ChunkRow = {
  id: string;
  document_id: string;
  company_id: string;
  chunk_index: number;
  page_start: number;
  page_end: number;
  char_count: number;
  content: string;
  chunk_label: string | null;
};

type FrameworkRow = {
  industry_type: string;
  display_name: string;
  cross_check_rules: Array<{
    rule_key: string;
    description: string;
    metric_a: string;
    metric_b: string;
    expected_relationship: string;
  }>;
  research_checks: Array<{
    check_key: string;
    category: ResearchCheck["category"];
    description: string;
    relevance_note: string;
    not_automatic_red_flag: true;
    context_required: string;
  }>;
};

export interface AnnualReportChunk {
  id: string;
  documentId: string;
  companyId: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  charCount: number;
  content: string;
  chunkLabel: string;
}

export interface AnnualReportSource {
  company: CompanyRow;
  document: DocumentRow;
  chunks: AnnualReportChunk[];
  contentChunks: AnnualReportChunk[];
  framework: IndustryFramework;
  databaseResearchChecks: ResearchCheck[];
  databaseCrossCheckRules: CrossCheckRule[];
}

export interface EvidencePack {
  sectionKey: AnnualReportSectionKey;
  chunks: AnnualReportChunk[];
  units: EvidenceUnit[];
}

export interface EvidenceUnit {
  id: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  lineStart: number;
  lineEnd: number;
  content: string;
}

const SECTION_QUERIES: Record<AnnualReportSectionKey, string[]> = {
  business: [
    "EBITDA of Oil to Chemicals",
    "Retail Segment recorded a Gross Revenue",
    "Revenue and EBITDA growth for the Digital Services business",
    "Oil and Gas EBITDA",
    "Management Discussion and Analysis Business Overview",
    "new energy systems",
    "segment revenue",
    "segment results",
  ],
  segments: [
    "Segment Revenue External Turnover",
    "Segment Result before Interest and Taxes",
    "Total Value of Sales and Services after elimination of inter segment turnover",
    "segment revenue",
    "segment results",
    "Oil to Chemicals",
    "Oil and Gas",
    "Retail",
    "Digital Services",
    "Financial Services",
    "segment assets",
  ],
  financial: [
    "10-Year Financial Highlights",
    "Value of Sales and Services Revenue",
    "Earnings Before Depreciation Finance Cost and Tax Expenses",
    "Profit for the Year",
    "consolidated statement of profit and loss",
    "earnings per share",
    "Consolidated revenue grew",
  ],
  financial_trends: [
    "10-Year Financial Highlights",
    "Value of Sales and Services",
    "Earnings Before Depreciation Finance Cost and Tax Expenses",
    "Profit for the Year",
    "Net Fixed Assets",
    "Consolidated",
  ],
  ratios: [
    "Current Ratio",
    "Debt-Equity Ratio",
    "Debt:Equity Ratio",
    "EBITDA/Gross Turnover",
    "Net Profit Margin",
    "Return on Net Worth",
    "ROCE",
  ],
  cash_balance_sheet: [
    "consolidated statement of cash flows",
    "Cash Generated from Operations",
    "Net Cash Flow from Operating Activities",
    "Net Cash Flow from Investing Activities",
    "Net Increase in Cash and Cash Equivalents",
    "capital expenditure",
    "Consolidated Net Debt",
    "Cash and Cash Equivalents as per Balance Sheet",
    "Borrowings Non-Current",
    "working capital",
  ],
  cash_flow: [
    "consolidated statement of cash flows",
    "Net Cash Flow from Operating Activities",
    "Net Cash Flow from Investing Activities",
    "Net Cash Flow from Financing Activities",
    "Net Increase in Cash and Cash Equivalents",
    "capital expenditure",
  ],
  balance_sheet: [
    "consolidated balance sheet",
    "total assets",
    "total equity",
    "current assets",
    "current liabilities",
    "Cash and Cash Equivalents as per Balance Sheet",
    "Net Fixed Assets",
  ],
  receivables: [
    "Trade Receivables 8",
    "trade receivables",
    "receivables",
    "expected credit loss",
    "ageing schedule",
    "credit risk",
  ],
  inventory: [
    "Inventories 6",
    "inventories",
    "inventory",
    "raw materials",
    "stock in trade",
    "inventory valuation",
  ],
  payables: [
    "Trade Payables Due to Micro and Small Enterprises",
    "trade payables",
    "payables",
    "micro small and medium enterprises",
    "supplier",
    "creditors",
  ],
  working_capital: [
    "Operating Profit before Working Capital Changes Inventories",
    "working capital",
    "trade receivables",
    "inventories",
    "trade payables",
    "current assets",
    "current liabilities",
    "current ratio",
  ],
  debt: [
    "Consolidated Net Debt",
    "borrowings",
    "Debt-Equity Ratio",
    "Debt:Equity Ratio",
    "finance cost",
    "interest coverage",
    "foreign currency borrowings",
  ],
  management: [
    "chairman's statement",
    "strategic priorities",
    "capital allocation",
    "investment priorities",
    "target",
    "guidance",
    "outlook",
  ],
  outlook: [
    "FY 2026-27 outlook remains",
    "outlook",
    "strategic priorities",
    "growth opportunities",
    "new energy",
    "investment priorities",
    "target",
    "guidance",
  ],
  industry: [
    "Global economic expansion continued",
    "Operating Environment",
    "market demand",
    "industry",
    "commodity prices",
    "regulatory",
    "competition",
    "digital services",
    "retail",
  ],
  related_parties: [
    "related party disclosures",
    "related party transactions",
    "key management personnel",
    "loans and advances",
    "guarantees",
    "receivables",
    "commercial rationale",
  ],
  governance: [
    "independent auditor's report",
    "key audit matters",
    "emphasis of matter",
    "qualified opinion",
    "internal financial controls",
    "auditor",
    "accounting policy",
  ],
  shareholders: [
    "shareholding pattern",
    "promoter and promoter group",
    "pledged",
    "equity shares",
    "major shareholders",
    "dilution",
    "beneficial owner",
  ],
  subsidiaries: [
    "material subsidiaries",
    "subsidiaries associates and joint ventures",
    "joint ventures",
    "associate companies",
    "financial information of subsidiaries",
    "investments in subsidiaries",
    "non-controlling interests",
  ],
  risks: [
    "risk management",
    "principal risks",
    "contingent liabilities",
    "litigation",
    "impairment",
    "cyber security",
    "commodity price risk",
    "regulatory risk",
  ],
  positives: [
    "growth",
    "commissioned",
    "launched",
    "expanded",
    "record",
    "milestone",
    "operational performance",
    "market leadership",
  ],
};

const FINANCIAL_BASIS_SECTION_KEYS = new Set<AnnualReportSectionKey>([
  "financial",
  "financial_trends",
  "ratios",
  "cash_balance_sheet",
  "cash_flow",
  "balance_sheet",
  "receivables",
  "inventory",
  "payables",
  "working_capital",
  "debt",
  "segments",
]);

const REQUIRED_ANCHOR_CHUNK_INDEXES: Partial<
  Record<AnnualReportSectionKey, number[]>
> = {
  industry: [44],
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%₹]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(query: string) {
  return normalize(query)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function scoreChunk(chunk: AnnualReportChunk, query: string) {
  const text = normalize(chunk.content);
  const phrase = normalize(query);
  let score = text.includes(phrase) ? 18 : 0;

  for (const token of queryTokens(query)) {
    const matches = text.match(new RegExp(`\\b${token}\\b`, "g"))?.length ?? 0;
    score += Math.min(matches, 8);
  }

  return score;
}

function scoreText(text: string, query: string) {
  const normalizedText = normalize(text);
  const phrase = normalize(query);
  let score = normalizedText.includes(phrase) ? 60 : 0;

  for (const token of queryTokens(query)) {
    const matches =
      normalizedText.match(new RegExp(`\\b${token}\\b`, "g"))?.length ?? 0;
    score += Math.min(matches, 8);
  }
  if (/\d/.test(text)) score += 2;

  return score;
}

function addChunk(
  selected: Map<number, AnnualReportChunk>,
  chunk: AnnualReportChunk | undefined,
) {
  if (chunk) selected.set(chunk.chunkIndex, chunk);
}

function selectSectionChunks(
  source: AnnualReportSource,
  sectionKey: AnnualReportSectionKey,
  limit = 8,
) {
  const selected = new Map<number, AnnualReportChunk>();
  const queries = SECTION_QUERIES[sectionKey];

  if (FINANCIAL_BASIS_SECTION_KEYS.has(sectionKey)) {
    const basisAnchors = source.contentChunks
      .map((chunk) => ({
        chunk,
        score:
          scoreChunk(chunk, "consolidated financial statements") +
          scoreChunk(chunk, "standalone financial statements"),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);
    for (const candidate of basisAnchors.slice(0, 2)) addChunk(selected, candidate.chunk);
  }

  for (const query of queries) {
    const ranked = source.contentChunks
      .map((chunk) => ({ chunk, score: scoreChunk(chunk, query) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);

    for (const candidate of ranked.slice(0, 2)) {
      addChunk(selected, candidate.chunk);
      if (selected.size >= limit) break;
    }
    if (selected.size >= limit) break;
  }

  if (selected.size < limit) {
    const combined = source.contentChunks
      .map((chunk) => ({
        chunk,
        score: queries.reduce((total, query) => total + scoreChunk(chunk, query), 0),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);
    for (const candidate of combined) {
      addChunk(selected, candidate.chunk);
      if (selected.size >= limit) break;
    }
  }

  const initial = [...selected.values()];
  for (const chunk of initial) {
    if (selected.size >= limit) break;
    addChunk(
      selected,
      source.contentChunks.find((candidate) => candidate.chunkIndex === chunk.chunkIndex - 1),
    );
    if (selected.size >= limit) break;
    addChunk(
      selected,
      source.contentChunks.find((candidate) => candidate.chunkIndex === chunk.chunkIndex + 1),
    );
  }

  return [...selected.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);
}

function buildEvidenceCandidates(source: AnnualReportSource) {
  const units: EvidenceUnit[] = [];

  for (const chunk of source.contentChunks) {
    const lines = chunk.content.split(/\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      for (let size = 1; size <= 2; size += 1) {
        const content = lines
          .slice(lineIndex, lineIndex + size)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(" ");
        if (content.length < 24 || content.length > 900) continue;
        const lineStart = lineIndex + 1;
        const lineEnd = Math.min(lines.length, lineIndex + size);
        units.push({
          id: `${chunk.chunkIndex}:${lineStart}-${lineEnd}`,
          chunkIndex: chunk.chunkIndex,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          lineStart,
          lineEnd,
          content,
        });
      }
    }
  }

  return units;
}

function selectEvidenceUnits(
  candidates: EvidenceUnit[],
  sectionKey: AnnualReportSectionKey,
  limit = 32,
) {
  const queries = SECTION_QUERIES[sectionKey];
  const selected = new Map<string, EvidenceUnit>();
  const selectedPerChunk = new Map<number, number>();

  const addUnit = (unit: EvidenceUnit) => {
    if (selected.has(unit.id)) return;
    const chunkCount = selectedPerChunk.get(unit.chunkIndex) ?? 0;
    if (chunkCount >= 6) return;
    selected.set(unit.id, unit);
    selectedPerChunk.set(unit.chunkIndex, chunkCount + 1);
  };

  for (const query of queries) {
    const ranked = candidates
      .map((unit) => ({ unit, score: scoreText(unit.content, query) }))
      .filter((candidate) => candidate.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.unit.chunkIndex - b.unit.chunkIndex ||
          a.unit.lineStart - b.unit.lineStart,
      );
    for (const candidate of ranked.slice(0, 4)) {
      addUnit(candidate.unit);
      if (selected.size >= limit) break;
    }
    if (selected.size >= limit) break;
  }

  if (selected.size < limit) {
    const combined = candidates
      .map((unit) => ({
        unit,
        score: queries.reduce(
          (total, query) => total + scoreText(unit.content, query),
          0,
        ),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.unit.chunkIndex - b.unit.chunkIndex ||
          a.unit.lineStart - b.unit.lineStart,
      );
    for (const candidate of combined) {
      addUnit(candidate.unit);
      if (selected.size >= limit) break;
    }
  }

  return [...selected.values()].sort(
    (a, b) => a.chunkIndex - b.chunkIndex || a.lineStart - b.lineStart,
  );
}

function mapCrossCheckRule(row: FrameworkRow["cross_check_rules"][number]): CrossCheckRule {
  return {
    ruleKey: row.rule_key,
    description: row.description,
    metricA: row.metric_a,
    metricB: row.metric_b,
    expectedRelationship: row.expected_relationship,
  };
}

function mapResearchCheck(row: FrameworkRow["research_checks"][number]): ResearchCheck {
  return {
    checkKey: row.check_key,
    category: row.category,
    description: row.description,
    relevanceNote: row.relevance_note,
    notAutomaticRedFlag: true,
    contextRequired: row.context_required,
  };
}

export async function loadRelianceAnnualReportSource(): Promise<AnnualReportSource> {
  const documentParams = new URLSearchParams({
    id: `eq.${RELIANCE_ANNUAL_REPORT_ID}`,
    select:
      "id,company_id,title,document_type,reporting_period,publication_date,document_date,text_extraction_status,processing_status",
  });
  const companyParams = new URLSearchParams({
    id: `eq.${RELIANCE_COMPANY_ID}`,
    select: "id,name,ticker,sector,industry",
  });
  const chunksParams = new URLSearchParams({
    document_id: `eq.${RELIANCE_ANNUAL_REPORT_ID}`,
    select:
      "id,document_id,company_id,chunk_index,page_start,page_end,char_count,content,chunk_label",
    order: "chunk_index.asc",
    limit: "500",
  });
  const frameworkParams = new URLSearchParams({
    industry_type: "eq.conglomerate",
    select:
      "industry_type,display_name,cross_check_rules,research_checks",
  });

  const [documents, companies, chunkRows, frameworkRows] = await Promise.all([
    supabaseRest<DocumentRow[]>("GET", `/documents?${documentParams.toString()}`),
    supabaseRest<CompanyRow[]>("GET", `/companies?${companyParams.toString()}`),
    supabaseRest<ChunkRow[]>("GET", `/document_chunks?${chunksParams.toString()}`),
    supabaseRest<FrameworkRow[]>(
      "GET",
      `/industry_frameworks?${frameworkParams.toString()}`,
    ),
  ]);

  const document = documents[0];
  const company = companies[0];
  const databaseFramework = frameworkRows[0];

  if (!document || !company) {
    throw new Error("Reliance annual-report preflight failed: document or company is missing");
  }
  if (
    document.id !== RELIANCE_ANNUAL_REPORT_ID ||
    document.company_id !== RELIANCE_COMPANY_ID ||
    document.document_type !== "annual_report" ||
    document.reporting_period !== RELIANCE_REPORTING_PERIOD ||
    document.text_extraction_status !== "complete" ||
    document.processing_status !== "processed"
  ) {
    throw new Error("Reliance annual-report preflight failed: document identity or status mismatch");
  }
  if (company.ticker !== "RELIANCE") {
    throw new Error("Reliance annual-report preflight failed: company ticker mismatch");
  }
  if (chunkRows.length !== EXPECTED_CHUNK_COUNT) {
    throw new Error(
      `Reliance annual-report preflight failed: expected ${EXPECTED_CHUNK_COUNT} chunks, found ${chunkRows.length}`,
    );
  }

  const chunks = chunkRows.map<AnnualReportChunk>((row) => ({
    id: row.id,
    documentId: row.document_id,
    companyId: row.company_id,
    chunkIndex: row.chunk_index,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    charCount: row.char_count,
    content: row.content,
    chunkLabel: row.chunk_label ?? `Chunk ${row.chunk_index}`,
  }));

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (
      chunk.chunkIndex !== index ||
      chunk.documentId !== RELIANCE_ANNUAL_REPORT_ID ||
      chunk.companyId !== RELIANCE_COMPANY_ID
    ) {
      throw new Error("Reliance annual-report preflight failed: chunk lineage mismatch");
    }
  }

  const coveredPages = new Set<number>();
  for (const chunk of chunks.filter((candidate) => candidate.chunkIndex > 0)) {
    for (let page = chunk.pageStart; page <= chunk.pageEnd; page += 1) {
      coveredPages.add(page);
    }
  }
  const missingPages = Array.from(
    { length: EXPECTED_PAGE_COUNT },
    (_, index) => index + 1,
  ).filter((page) => !coveredPages.has(page));
  if (missingPages.length > 0 || Math.max(...coveredPages) !== EXPECTED_PAGE_COUNT) {
    throw new Error(
      `Reliance annual-report preflight failed: page coverage mismatch (${missingPages.length} missing)`,
    );
  }

  const framework = selectFramework({
    industry: company.industry,
    sector: company.sector,
  });
  if (framework.industryType !== "conglomerate" || !databaseFramework) {
    throw new Error("Reliance annual-report preflight failed: conglomerate framework is unavailable");
  }

  const databaseCrossCheckRules = databaseFramework.cross_check_rules.map(mapCrossCheckRule);
  const expectedRuleKeys = new Set(framework.crossCheckRules.map((rule) => rule.ruleKey));
  if (
    databaseCrossCheckRules.length === 0 ||
    databaseCrossCheckRules.some((rule) => !expectedRuleKeys.has(rule.ruleKey))
  ) {
    throw new Error("Reliance annual-report preflight failed: cross-check framework mismatch");
  }

  return {
    company,
    document,
    chunks,
    contentChunks: chunks.filter((chunk) => chunk.chunkIndex > 0),
    framework,
    databaseResearchChecks: (databaseFramework.research_checks ?? []).map(mapResearchCheck),
    databaseCrossCheckRules,
  };
}

export function retrieveAnnualReportEvidence(
  source: AnnualReportSource,
): EvidencePack[] {
  const candidates = buildEvidenceCandidates(source);
  return ANNUAL_REPORT_SECTION_KEYS.map((sectionKey) => {
    const units = selectEvidenceUnits(candidates, sectionKey);
    const chunkIndexes = new Set(units.map((unit) => unit.chunkIndex));
    for (const chunkIndex of REQUIRED_ANCHOR_CHUNK_INDEXES[sectionKey] ?? []) {
      chunkIndexes.add(chunkIndex);
    }
    const chunks = source.contentChunks.filter((chunk) =>
      chunkIndexes.has(chunk.chunkIndex),
    );
    if (units.length < 12 || chunks.length < 2) {
      throw new Error(
        `Reliance annual-report retrieval failed: insufficient evidence units for ${sectionKey}`,
      );
    }
    return { sectionKey, chunks, units };
  });
}

export function formatEvidencePack(pack: EvidencePack) {
  return pack.units
    .map(
      (unit) =>
        `--- EVIDENCE ${unit.id} | chunk ${unit.chunkIndex} | pages ${unit.pageStart}-${unit.pageEnd} ---\n` +
        unit.content,
    )
    .join("\n\n");
}