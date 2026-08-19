import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import {
  ANNUAL_REPORT_SECTION_KEYS,
  RELIANCE_COMPANY_ID,
  RELIANCE_REPORTING_PERIOD,
  type AnnualReportSource,
} from "./annual-report-source.js";
import {
  renderQuickViewItem,
  renderSectionContent,
} from "./annual-report-generator.js";
import type {
  GeneratedCrossCheck,
  QuickViewAnalysis,
  ResearchConclusion,
  SectionAnalysis,
} from "./annual-report-types.js";
import { SupabaseRestError, supabaseRest } from "./supabase-rest.js";

type ResearchJobRow = {
  id: string;
};

type ResearchRow = {
  id: string;
};

type StoredRow = Record<string, unknown> & {
  id: string;
};

type SafeReplacement = {
  count: number;
  rollback: () => Promise<void>;
};

const RELIANCE_RESEARCH_LOCK_ID = "00000000-0000-4000-8000-000000000526";

export interface PublishedResearchSummary {
  evidenceRows: number;
  crossCheckRows: number;
  researchRows: number;
}

function nowIso() {
  return new Date().toISOString();
}

export async function acquireResearchRunLock() {
  const ownerToken = randomUUID();
  const lockBody = {
    id: RELIANCE_RESEARCH_LOCK_ID,
    company_id: RELIANCE_COMPANY_ID,
    status: "RUNNING",
    industry_type: "conglomerate-lock",
    sections_requested: [],
    sections_completed: [],
    sections_failed: [],
    error_message: ownerToken,
    started_at: nowIso(),
  };

  const tryAcquire = () =>
    supabaseRest<void>("POST", "/research_jobs", {
      prefer: "return=minimal",
      body: lockBody,
    });

  try {
    await tryAcquire();
    return ownerToken;
  } catch (error) {
    if (error instanceof SupabaseRestError && error.status === 409) {
      throw new Error("A Reliance annual-report research run is already active");
    }
    throw error;
  }
}

export async function releaseResearchRunLock(ownerToken: string) {
  const params = new URLSearchParams({
    id: `eq.${RELIANCE_RESEARCH_LOCK_ID}`,
    error_message: `eq.${ownerToken}`,
  });
  await supabaseRest<void>(
    "DELETE",
    `/research_jobs?${params.toString()}`,
    { prefer: "return=minimal" },
  );
}

async function deleteRowsByIds(table: string, ids: string[]) {
  if (ids.length === 0) return;
  await supabaseRest<void>(
    "DELETE",
    `/${table}?id=in.(${encodeURIComponent(ids.join(","))})`,
    { prefer: "return=minimal" },
  );
}

async function safeReplaceRows(
  table: string,
  existingPath: string,
  rows: Array<Record<string, unknown>>,
): Promise<SafeReplacement> {
  const existing = await supabaseRest<StoredRow[]>(
    "GET",
    `${existingPath}${existingPath.includes("?") ? "&" : "?"}select=*`,
  );
  const inserted = await supabaseRest<StoredRow[]>("POST", `/${table}`, {
    prefer: "return=representation",
    body: rows,
  });
  const insertedIds = inserted.map((row) => row.id).filter(Boolean);
  if (insertedIds.length !== rows.length) {
    await deleteRowsByIds(table, insertedIds);
    throw new Error(
      `${table} replacement inserted ${insertedIds.length} of ${rows.length} rows`,
    );
  }

  try {
    await deleteRowsByIds(
      table,
      existing.map((row) => row.id),
    );
  } catch (error) {
    await deleteRowsByIds(table, insertedIds);
    throw error;
  }

  return {
    count: rows.length,
    rollback: async () => {
      if (existing.length > 0) {
        await supabaseRest<void>("POST", `/${table}`, {
          prefer: "return=minimal",
          body: existing,
        });
      }
      await deleteRowsByIds(table, insertedIds);
    },
  };
}

function pageSource(conclusion: ResearchConclusion, source: AnnualReportSource) {
  const pages = [
    ...new Set(
      conclusion.citations.map((citation) =>
        citation.pageStart === citation.pageEnd
          ? String(citation.pageStart)
          : `${citation.pageStart}-${citation.pageEnd}`,
      ),
    ),
  ];
  const chunks = [
    ...new Set(conclusion.citations.map((citation) => citation.chunkIndex)),
  ];
  const basis =
    conclusion.financialFigure &&
    ["CONSOLIDATED", "STANDALONE"].includes(conclusion.accountingBasis)
      ? `; ${conclusion.accountingBasis} basis`
      : "";
  if (pages.length === 0) {
    return `${source.document.title}; evidence insufficient${basis}`;
  }
  return `${source.document.title}, page ${pages.join(", ")}, chunk ${chunks.join(", ")}${basis}`;
}

function evidenceRows(
  source: AnnualReportSource,
  sections: SectionAnalysis[],
  quickView: QuickViewAnalysis,
) {
  const sectionConclusions = sections.flatMap((section) => section.conclusions);
  const quickConclusions = Object.values(quickView.items).map(
    (item) => item.conclusion,
  );

  return [...sectionConclusions, ...quickConclusions].map((conclusion) => ({
    company_id: RELIANCE_COMPANY_ID,
    document_id: source.document.id,
    report_section: conclusion.sectionKey,
    period: RELIANCE_REPORTING_PERIOD,
    claim: conclusion.claim,
    evidence_type: conclusion.classification,
    supporting_source: pageSource(conclusion, source),
    source_date:
      source.document.publication_date ?? source.document.document_date ?? null,
    data_point: conclusion.dataPoint
      ? conclusion.financialFigure
        ? `[${conclusion.accountingBasis}] ${conclusion.dataPoint}`
        : conclusion.dataPoint
      : null,
    ai_interpretation:
      conclusion.classification === "INFERENCE" ? conclusion.claim : null,
    confidence_level: conclusion.confidence,
  }));
}

function crossCheckRows(crossChecks: GeneratedCrossCheck[]) {
  return crossChecks.map((crossCheck) => ({
    company_id: RELIANCE_COMPANY_ID,
    period: RELIANCE_REPORTING_PERIOD,
    rule_key: crossCheck.ruleKey,
    rule_description: crossCheck.ruleDescription,
    metric_a_name: crossCheck.metricAName,
    metric_a_value: crossCheck.metricAValue,
    metric_b_name: crossCheck.metricBName,
    metric_b_value: crossCheck.metricBValue,
    expected_relationship: crossCheck.expectedRelationship,
    result: crossCheck.result,
    finding: crossCheck.finding,
    severity: crossCheck.severity,
  }));
}

function combineSections(
  headingA: string,
  sectionA: SectionAnalysis,
  headingB: string,
  sectionB: SectionAnalysis,
) {
  return `${headingA}\n\n${renderSectionContent(sectionA)}\n\n${headingB}\n\n${renderSectionContent(sectionB)}`;
}

function buildResearchRows(
  sections: SectionAnalysis[],
  quickView: QuickViewAnalysis,
) {
  const byKey = new Map(sections.map((section) => [section.sectionKey, section]));
  const requireSection = (key: SectionAnalysis["sectionKey"]) => {
    const section = byKey.get(key);
    if (!section) throw new Error(`Missing generated section: ${key}`);
    return section;
  };

  const business = requireSection("business");
  const segments = requireSection("segments");
  const financial = requireSection("financial");
  const financialTrends = requireSection("financial_trends");
  const ratios = requireSection("ratios");
  const cashFlow = requireSection("cash_flow");
  const balanceSheet = requireSection("balance_sheet");
  const receivables = requireSection("receivables");
  const inventory = requireSection("inventory");
  const payables = requireSection("payables");
  const workingCapital = requireSection("working_capital");
  const debt = requireSection("debt");
  const management = requireSection("management");
  const outlook = requireSection("outlook");
  const industry = requireSection("industry");
  const relatedParties = requireSection("related_parties");
  const governance = requireSection("governance");
  const shareholders = requireSection("shareholders");
  const subsidiaries = requireSection("subsidiaries");
  const risks = requireSection("risks");
  const positives = requireSection("positives");
  const quick = quickView.items;
  const lastUpdated = nowIso();
  const researchRow = (section: string, title: string, content: string) => ({
    company_id: RELIANCE_COMPANY_ID,
    section,
    title,
    content,
    last_updated: lastUpdated,
  });

  return [
    researchRow("company", "Business", renderSectionContent(business)),
    researchRow(
      "what_happened",
      "Current Direction",
      `${renderQuickViewItem(quick.whatIsHappening)}\n\nWHY IT MATTERS\n${renderQuickViewItem(quick.whatMattersMost)}`,
    ),
    researchRow("segments", "Segment Analysis", renderSectionContent(segments)),
    researchRow(
      "financial_statements",
      "Financial Statements",
      renderSectionContent(financial),
    ),
    researchRow(
      "financial_trends",
      "Five-Year Financial Trends",
      renderSectionContent(financialTrends),
    ),
    researchRow("ratios", "Financial Ratios", renderSectionContent(ratios)),
    researchRow("cash_flow", "Cash Flow", renderSectionContent(cashFlow)),
    researchRow(
      "balance_sheet",
      "Balance Sheet",
      renderSectionContent(balanceSheet),
    ),
    researchRow(
      "receivables",
      "Receivables",
      renderSectionContent(receivables),
    ),
    researchRow("inventory", "Inventory", renderSectionContent(inventory)),
    researchRow("payables", "Payables", renderSectionContent(payables)),
    researchRow(
      "working_capital",
      "Working Capital",
      renderSectionContent(workingCapital),
    ),
    researchRow("debt", "Debt & Liquidity", renderSectionContent(debt)),
    researchRow(
      "management",
      "Management & Capital Allocation",
      renderSectionContent(management),
    ),
    researchRow("outlook", "Outlook & Guidance", renderSectionContent(outlook)),
    researchRow("industry", "Industry Context", renderSectionContent(industry)),
    researchRow(
      "shareholders",
      "Shareholders & Ownership",
      renderSectionContent(shareholders),
    ),
    researchRow(
      "governance",
      "Governance & Auditor",
      renderSectionContent(governance),
    ),
    researchRow(
      "related_parties",
      "Related-Party Transactions",
      renderSectionContent(relatedParties),
    ),
    researchRow(
      "subsidiaries",
      "Subsidiaries / JVs",
      renderSectionContent(subsidiaries),
    ),
    researchRow(
      "what_is_going_wrong",
      "Material Risks",
      `${renderQuickViewItem(quick.biggestConcern)}\n\n${renderSectionContent(risks)}`,
    ),
    researchRow(
      "what_is_going_well",
      "Positive Developments",
      `${renderQuickViewItem(quick.biggestPositive)}\n\n${renderSectionContent(positives)}`,
    ),
    researchRow(
      "what_to_watch",
      "What Investors Should Monitor",
      renderQuickViewItem(quick.whatToWatch),
    ),
    researchRow(
      "summary",
      "Investor Takeaway",
      `${renderQuickViewItem(quick.investorTakeaway)}\n\nNo buy, sell, or hold recommendation is provided because valuation and current market expectations are outside this phase.`,
    ),
  ];
}

export async function createResearchJob() {
  const rows = await supabaseRest<ResearchJobRow[]>("POST", "/research_jobs", {
    prefer: "return=representation",
    body: {
      company_id: RELIANCE_COMPANY_ID,
      status: "RUNNING",
      industry_type: "conglomerate",
      sections_requested: ["quick_view", ...ANNUAL_REPORT_SECTION_KEYS, "takeaway"],
      sections_completed: [],
      sections_failed: [],
      error_message: null,
      started_at: nowIso(),
    },
  });
  const jobId = rows[0]?.id;
  if (!jobId) throw new Error("Research job creation returned no ID");
  return jobId;
}

export async function completeResearchJob(
  jobId: string,
  sectionsCompleted: string[],
  sectionsFailed: string[],
) {
  await supabaseRest<void>(
    "PATCH",
    `/research_jobs?id=eq.${encodeURIComponent(jobId)}`,
    {
      prefer: "return=minimal",
      body: {
        status: "COMPLETE",
        sections_completed: sectionsCompleted,
        sections_failed: sectionsFailed,
        completed_at: nowIso(),
      },
    },
  );
}

export async function failResearchJob(jobId: string, error: unknown) {
  await supabaseRest<void>(
    "PATCH",
    `/research_jobs?id=eq.${encodeURIComponent(jobId)}`,
    {
      prefer: "return=minimal",
      body: {
        status: "FAILED",
        error_message: String(error).slice(0, 2_000),
        completed_at: nowIso(),
      },
    },
  );
}

async function replaceEvidence(
  source: AnnualReportSource,
  sections: SectionAnalysis[],
  quickView: QuickViewAnalysis,
) {
  const rows = evidenceRows(source, sections, quickView);
  return safeReplaceRows(
    "analysis_evidence",
    `/analysis_evidence?document_id=eq.${encodeURIComponent(source.document.id)}`,
    rows,
  );
}

async function replaceCrossChecks(crossChecks: GeneratedCrossCheck[]) {
  const rows = crossCheckRows(crossChecks);
  const params = new URLSearchParams({
    company_id: `eq.${RELIANCE_COMPANY_ID}`,
    period: `eq.${RELIANCE_REPORTING_PERIOD}`,
  });
  return safeReplaceRows("cross_checks", `/cross_checks?${params.toString()}`, rows);
}

async function publishResearch(
  sections: SectionAnalysis[],
  quickView: QuickViewAnalysis,
) {
  const rows = buildResearchRows(sections, quickView);
  const existingParams = new URLSearchParams({
    company_id: `eq.${RELIANCE_COMPANY_ID}`,
  });
  return safeReplaceRows("research", `/research?${existingParams.toString()}`, rows);
}

export async function publishAnnualReportResearch(
  source: AnnualReportSource,
  sections: SectionAnalysis[],
  quickView: QuickViewAnalysis,
  crossChecks: GeneratedCrossCheck[],
): Promise<PublishedResearchSummary> {
  const replacements: SafeReplacement[] = [];
  try {
    replacements.push(await replaceEvidence(source, sections, quickView));
    replacements.push(await replaceCrossChecks(crossChecks));
    replacements.push(await publishResearch(sections, quickView));
  } catch (error) {
    for (const replacement of replacements.reverse()) {
      try {
        await replacement.rollback();
      } catch (rollbackError) {
        logger.error(
          { rollbackError },
          "Could not roll back a partially published research replacement",
        );
      }
    }
    throw error;
  }
  const [evidence, crossCheck, research] = replacements;
  if (!evidence || !crossCheck || !research) {
    throw new Error("Annual-report publication did not complete every replacement");
  }

  logger.info(
    {
      documentId: source.document.id,
      evidenceCount: evidence.count,
      crossCheckCount: crossCheck.count,
      researchCount: research.count,
    },
    "Annual-report research published",
  );

  return {
    evidenceRows: evidence.count,
    crossCheckRows: crossCheck.count,
    researchRows: research.count,
  };
}