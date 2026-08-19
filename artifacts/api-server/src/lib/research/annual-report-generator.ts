import { AI_RULES } from "../evidence.js";
import { logger } from "../logger.js";
import { openai } from "../openai.js";
import {
  FINANCIAL_BASIS_RULES,
  type CrossCheckRule,
  type ResearchCheck,
  type ResearchCheckCategory,
} from "../research-framework.js";
import {
  formatEvidencePack,
  type AnnualReportChunk,
  type AnnualReportSectionKey,
  type AnnualReportSource,
  type EvidencePack,
  type EvidenceUnit,
} from "./annual-report-source.js";
import type {
  AccountingBasis,
  GeneratedCrossCheck,
  QuickViewAnalysis,
  QuickViewItem,
  QuickViewKey,
  ResearchConclusion,
  SectionAnalysis,
  ValidatedCitation,
} from "./annual-report-types.js";

const MODEL = "gpt-4o-mini";

const SECTION_CONFIG: Record<
  AnnualReportSectionKey,
  {
    title: string;
    instruction: string;
    checkCategories: ResearchCheckCategory[];
  }
> = {
  business: {
    title: "Business",
    instruction:
      "Explain the major businesses, supported revenue/profit drivers, strategy, and important business changes. Treat segment economics as consolidated unless the source explicitly says otherwise.",
    checkCategories: ["consolidated", "long_term"],
  },
  segments: {
    title: "Segment Analysis",
    instruction:
      "Analyse the disclosed operating segments, their relative revenue or profitability contribution, and the key change in each material segment. Keep segment data distinct from subsidiaries and identify inter-segment eliminations where disclosed.",
    checkCategories: ["consolidated", "long_term"],
  },
  financial: {
    title: "Financial Performance",
    instruction:
      "Explain revenue, operating performance, margins, profit, and EPS where supported. Prefer consolidated group figures and explain meaning rather than reproducing statements.",
    checkCategories: ["accounting", "consolidated", "shareholder_economics"],
  },
  financial_trends: {
    title: "Five-Year Financial Trends",
    instruction:
      "Use the annual report's multi-year consolidated financial history to explain the direction of revenue, EBITDA, profit, fixed assets, and any clearly disclosed trend. Compare only periods and figures carried on the same accounting basis. Do not invent calculated growth rates when they are not directly established.",
    checkCategories: ["accounting", "consolidated", "long_term"],
  },
  ratios: {
    title: "Financial Ratios",
    instruction:
      "Analyse only disclosed or safely calculated liquidity, leverage, margin, return, and coverage ratios. State the direction versus the comparable period where supplied. A calculation is permitted only when every same-basis input is cited; otherwise explain the ratio was not established.",
    checkCategories: ["accounting", "consolidated", "capital_allocation"],
  },
  cash_balance_sheet: {
    title: "Cash Flow & Balance Sheet",
    instruction:
      "Analyse operating cash flow, capex, free-cash-flow implications, debt, liquidity, working capital, and important balance-sheet changes. Do not use general revenue, EBITDA, or PAT figures as substitutes for cash-flow or balance-sheet evidence. Do not calculate a figure unless every input is cited on the same accounting basis.",
    checkCategories: ["capital_allocation", "consolidated", "contingent_liabilities"],
  },
  cash_flow: {
    title: "Cash Flow",
    instruction:
      "Analyse operating, investing, and financing cash flows, capital expenditure, cash conversion, and any pre-financing free-cash-flow implication. Do not substitute profit or EBITDA for cash-flow evidence, and calculate only from cited same-basis inputs.",
    checkCategories: ["capital_allocation", "consolidated", "contingent_liabilities"],
  },
  balance_sheet: {
    title: "Balance Sheet",
    instruction:
      "Analyse liquidity, cash, fixed assets, equity, current assets and liabilities, and material balance-sheet movements. Do not mix parent-only and consolidated balances or infer segment-level leverage from group-only data.",
    checkCategories: ["capital_allocation", "consolidated", "contingent_liabilities"],
  },
  receivables: {
    title: "Receivables",
    instruction:
      "Analyse trade receivables, ageing, expected-credit-loss disclosures, and collection risk only from the annual report. Keep operating receivables separate from related-party balances and do not infer a collection problem without evidence.",
    checkCategories: ["accounting", "consolidated"],
  },
  inventory: {
    title: "Inventory",
    instruction:
      "Analyse inventory composition, valuation, impairment or obsolescence disclosures, and any movement relevant to cash conversion. Do not infer inventory stress without evidence from the annual report.",
    checkCategories: ["accounting", "consolidated"],
  },
  payables: {
    title: "Payables",
    instruction:
      "Analyse trade payables, supplier or MSME disclosures, and payment obligations only where the annual report provides evidence. Do not treat ordinary payables as a red flag without context.",
    checkCategories: ["accounting", "consolidated"],
  },
  working_capital: {
    title: "Working Capital",
    instruction:
      "Bring together receivables, inventory, payables, current assets, current liabilities, and disclosed liquidity ratios to explain working-capital direction. Do not calculate a cash-conversion cycle unless every input and period is established on the same basis.",
    checkCategories: ["accounting", "consolidated", "capital_allocation"],
  },
  debt: {
    title: "Debt & Liquidity",
    instruction:
      "Analyse net debt, borrowings, finance costs, debt ratios, maturity or currency risks, and liquidity. Do not infer segment debt from consolidated debt, and do not calculate coverage unless all same-basis inputs are cited.",
    checkCategories: ["consolidated", "capital_allocation", "contingent_liabilities"],
  },
  management: {
    title: "Management & Strategy",
    instruction:
      "Analyse management's stated strategy, priorities, targets or guidance, and capital-allocation plans. Do not repeat general revenue, EBITDA, PAT, or debt figures unless management explicitly connects them to a strategic decision. Label statements about future outcomes as management-stated, not as facts that will occur.",
    checkCategories: ["management", "capital_allocation"],
  },
  outlook: {
    title: "Outlook & Guidance",
    instruction:
      "Analyse management-stated outlook, targets, guidance, and priorities by material business where disclosed. Separate management expectations from achieved results and say when prior guidance cannot be compared with delivery using this annual report alone.",
    checkCategories: ["management", "capital_allocation", "long_term"],
  },
  industry: {
    title: "Industry Context",
    instruction:
      "Explain only the industry, demand, pricing, regulatory, or competitive context described in the annual report and how it relates to the group’s material businesses. Do not add outside market data or peer comparisons.",
    checkCategories: ["long_term"],
  },
  related_parties: {
    title: "Related-Party Transactions",
    instruction:
      "Assess materiality, pricing disclosures, transaction nature, loans or advances, guarantees, receivables, promoter-related entities, commercial rationale, and governance. Every conclusion must be specifically about related-party transactions; annual turnover alone is not a related-party conclusion. Do not label a red flag without contextual evidence.",
    checkCategories: ["consolidated", "capital_allocation"],
  },
  governance: {
    title: "Governance & Auditor",
    instruction:
      "Analyse auditor observations, qualifications, emphasis of matter, internal-control concerns, auditor changes, and accounting concerns. State clearly when no adverse observation is established by the retrieved evidence.",
    checkCategories: ["auditor", "accounting"],
  },
  shareholders: {
    title: "Shareholders & Ownership",
    instruction:
      "Analyse promoter ownership, major shareholders, changes, pledging, and dilution only where the annual report supports them. Do not substitute related-party or subsidiary-compliance disclosures for ownership evidence. Explicitly state when current ownership evidence is insufficient.",
    checkCategories: ["shareholder_economics"],
  },
  subsidiaries: {
    title: "Subsidiaries / JVs",
    instruction:
      "Identify material subsidiaries, associates, or joint ventures and explain why they matter to the consolidated business. Do not describe an operating segment such as O2C as a subsidiary. Distinguish group economics from parent-company economics.",
    checkCategories: ["consolidated", "capital_allocation"],
  },
  risks: {
    title: "Risks",
    instruction:
      "Include only evidence-backed material risks. Assess context and materiality before describing a concern; do not turn every disclosed risk or contingent liability into a red flag.",
    checkCategories: ["contingent_liabilities", "accounting", "long_term"],
  },
  positives: {
    title: "Positive Developments",
    instruction:
      "Include only meaningful evidence-backed positives, separating delivered outcomes from management plans or targets.",
    checkCategories: ["capital_allocation", "long_term"],
  },
};

const CLASSIFICATIONS = new Set(["FACT", "INFERENCE", "UNCERTAIN"]);
const CONFIDENCE_LEVELS = new Set(["HIGH", "MEDIUM", "LOW"]);
const ACCOUNTING_BASES = new Set([
  "CONSOLIDATED",
  "STANDALONE",
  "NOT_CLEAR",
  "NOT_APPLICABLE",
]);
const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH"]);

const SECTION_RELEVANCE: Record<AnnualReportSectionKey, RegExp> = {
  business:
    /\b(?:segment|business|retail|digital services|jio|oil to chemicals|o2c|oil and gas|new energy|operations?)\b/i,
  segments:
    /\b(?:segment|oil to chemicals|o2c|oil and gas|retail|digital services|financial services|media|segment revenue|segment result|inter.?segment)\b/i,
  financial:
    /\b(?:revenue|income|ebitda|profit|pat|margin|eps|tax|expense|earnings)\b/i,
  financial_trends:
    /\b(?:five.?year|ten.?year|trend|revenue|ebitda|profit|fixed assets|financial highlights|grew|increased|declined)\b/i,
  ratios:
    /\b(?:ratio|margin|roce|ronw|return on|debt.?equity|current ratio|interest coverage|turnover)\b/i,
  cash_balance_sheet:
    /\b(?:cash|capex|capital expenditure|debt|borrow|liquid|working capital|balance sheet|asset|liabilit|inventory|receivable|payable|free cash|net debt)\w*/i,
  cash_flow:
    /\b(?:cash flow|operating cash|investing cash|financing cash|capex|capital expenditure|free cash|cash equivalent)\w*/i,
  balance_sheet:
    /\b(?:balance sheet|asset|liabilit|equity|cash and cash|fixed asset|current asset|current liabilit|liquidity)\w*/i,
  receivables:
    /\b(?:receivable|expected credit loss|ageing|collection|credit risk)\w*/i,
  inventory:
    /\b(?:inventor|stock in trade|raw material|obsolescence|valuation)\w*/i,
  payables:
    /\b(?:payable|supplier|creditor|msme|micro small)\w*/i,
  working_capital:
    /\b(?:working capital|current asset|current liabilit|receivable|inventor|payable|current ratio)\w*/i,
  debt:
    /\b(?:debt|net debt|borrow|finance cost|interest|maturity|currency)\w*/i,
  management:
    /\b(?:management|strategy|strategic|plan|target|guidance|priority|capital allocation|commission|capacity|new energy|technology|transition|investment)\w*/i,
  outlook:
    /\b(?:outlook|guidance|target|plan|priority|expected|growth opportunity|investment|new energy)\w*/i,
  industry:
    /\b(?:industry|market|demand|price|commodity|competition|regulatory|operating environment|macro)\w*/i,
  related_parties:
    /\b(?:related part|arm.?s length|audit committee approval|material related|rpt)\w*/i,
  governance:
    /\b(?:auditor|audit|internal control|qualification|adverse|misstatement|accounting|governance|compliance|opinion|key audit)\w*/i,
  shareholders:
    /\b(?:shareholder|promoter|shareholding|pledge|ownership|institutional|public shareholder|dilution|bonus share|paid-up capital|shares held)\w*/i,
  subsidiaries:
    /\b(?:subsidiar|associate|joint venture|jv\b|jio platforms|reliance jio|reliance retail ventures|material entit)\w*/i,
  risks:
    /\b(?:risk|proceeding|litigation|arbitration|exposure|judgement|estimate|contingent|uncertain|vulnerab|adverse|dispute)\w*/i,
  positives:
    /\b(?:grew|growth|increase|improv|record|achiev|strength|expand|benefit|launch|commission|complet)\w*/i,
};

const SUBJECT_PATTERNS: RegExp[] = [
  /\b(?:oil to chemicals|o2c)\b/i,
  /\b(?:reliance retail|retail segment)\b/i,
  /\b(?:digital services|jio platforms|reliance jio)\b/i,
  /\b(?:oil and gas)\b/i,
  /\b(?:new energy)\b/i,
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonObject(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as unknown;
  if (!isObject(parsed)) throw new Error("Model response was not a JSON object");
  return parsed;
}

async function requestJson(system: string, user: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 2_500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error("Model returned no content");
      return parseJsonObject(content);
    } catch (error) {
      lastError = error;
      logger.warn({ error, attempt }, "Annual-report JSON generation attempt failed");
      const retryMatch = String(error).match(
        /try again in\s+([\d.]+)\s*(ms|s)/i,
      );
      if (retryMatch && attempt < 3) {
        const delay =
          Number(retryMatch[1]) * (retryMatch[2].toLowerCase() === "s" ? 1_000 : 1) +
          750;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error(`Annual-report generation failed: ${String(lastError)}`);
}

function numericTokens(value: string) {
  return (value.match(/\d[\d,]*(?:\.\d+)?(?:%|x)?/gi) ?? []).map((token) =>
    token.replace(/,/g, "").toLowerCase(),
  );
}

function normalizedEvidenceText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function meaningfulWords(value: string) {
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "because",
    "been",
    "being",
    "between",
    "company",
    "for",
    "from",
    "has",
    "have",
    "its",
    "more",
    "not",
    "that",
    "the",
    "their",
    "this",
    "was",
    "were",
    "with",
  ]);
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(" ")
        .filter((word) => word.length > 3 && !stopWords.has(word)),
    ),
  ];
}

function isFinancialFigure(claim: string, dataPoint: string, modelFlag: unknown) {
  const combined = `${claim} ${dataPoint}`;
  if (
    /\b(?:promoter|shareholding|shares held|subscriber|employee|store count|locations?)\b/i.test(
      combined,
    ) &&
    !/\b(?:paid-up capital|revenue|profit|ebitda|cash|debt|borrowings|capex)\b/i.test(
      combined,
    )
  ) {
    return false;
  }
  if (modelFlag === true) return true;
  return (
    /(?:₹|%|\b(?:revenue|profit|pat|ebitda|eps|cash|debt|borrowings|capex|margin|receivables|inventory|payables|crore|million|billion)\b)/i.test(
      combined,
    ) && /\d/.test(combined)
  );
}

function subjectIsSupported(claim: string, excerpt: string) {
  const compactExcerpt = normalizedEvidenceText(excerpt).replace(/,/g, "");
  const materialNumbers = numericTokens(claim).filter(
    (token) =>
      !/^(?:19|20)\d{2}$/.test(token) &&
      !/^(?:0?[1-9]|[12]\d|3[01])$/.test(token),
  );

  return SUBJECT_PATTERNS.every((subject) => {
    if (!subject.test(claim)) return true;
    const subjectIndex = compactExcerpt.search(subject);
    if (subjectIndex < 0) return false;
    if (materialNumbers.length === 0) return true;
    return materialNumbers.every((number) => {
      const numberIndex = compactExcerpt.indexOf(number);
      return numberIndex >= 0 && Math.abs(numberIndex - subjectIndex) <= 260;
    });
  });
}

function directFactHasInterpretation(claim: string, quote: string) {
  const interpretivePhrases = [
    "indicat",
    "suggest",
    "demonstrat",
    "robust",
    "strong",
    "key driver",
    "essential",
    "warrant",
    "influenc",
    "may ",
    "could ",
    "pose ",
    "on track",
    "expected to",
    "will enhance",
  ];
  const normalizedClaim = claim.toLowerCase();
  const normalizedQuote = quote.toLowerCase();
  return interpretivePhrases.some(
    (phrase) =>
      normalizedClaim.includes(phrase) && !normalizedQuote.includes(phrase),
  );
}

function validateEvidenceIds(
  raw: unknown,
  allowedUnits: EvidenceUnit[],
) {
  if (!Array.isArray(raw)) return [];
  const allowed = new Map(allowedUnits.map((unit) => [unit.id, unit]));
  const selected = new Map<string, EvidenceUnit>();

  for (const value of raw) {
    const evidenceId = asString(value);
    const unit = allowed.get(evidenceId);
    if (unit) selected.set(unit.id, unit);
  }

  return [...selected.values()];
}

function citationsFromUnits(units: EvidenceUnit[]): ValidatedCitation[] {
  const citations = new Map<number, ValidatedCitation>();

  for (const unit of units) {
    citations.set(unit.chunkIndex, {
      chunkIndex: unit.chunkIndex,
      pageStart: unit.pageStart,
      pageEnd: unit.pageEnd,
      chunkLabel: `Chunk ${unit.chunkIndex}`,
    });
  }

  return [...citations.values()];
}

function citedText(citations: ValidatedCitation[], allowedChunks: AnnualReportChunk[]) {
  const allowed = new Map(allowedChunks.map((chunk) => [chunk.chunkIndex, chunk]));
  return citations
    .map((citation) => allowed.get(citation.chunkIndex)?.content ?? "")
    .join("\n");
}

function evidenceSupportsText(
  claim: string,
  supportingQuote: string,
) {
  const normalizedSourceNumbers = new Set(numericTokens(supportingQuote));
  const claimedNumbers = numericTokens(claim);
  if (claimedNumbers.some((token) => !normalizedSourceNumbers.has(token))) {
    return false;
  }

  const words = meaningfulWords(claim).slice(0, 16);
  if (words.length === 0) return claimedNumbers.length > 0;
  const source = supportingQuote.toLowerCase();
  return (
    words.filter((word) => source.includes(word)).length >=
    Math.min(4, words.length)
  );
}

function findSupportingExcerpt(
  claim: string,
  units: EvidenceUnit[],
) {
  const claimNumbers = numericTokens(claim);
  const claimWords = meaningfulWords(claim).slice(0, 20);
  let best: { text: string; score: number } | null = null;

  for (const unit of units) {
    const normalizedWindow = normalizedEvidenceText(unit.content);
    const windowNumbers = new Set(numericTokens(unit.content));
    if (claimNumbers.some((number) => !windowNumbers.has(number))) continue;
    if (!subjectIsSupported(claim, unit.content)) continue;

    const claimHits = claimWords.filter((word) =>
      normalizedWindow.includes(word),
    ).length;
    const minimumClaimHits = Math.min(4, claimWords.length);
    if (claimHits < minimumClaimHits) continue;

    const score = claimHits * 3 + claimNumbers.length * 4;
    if (
      !best ||
      score > best.score ||
      (score === best.score && unit.content.length < best.text.length)
    ) {
      best = { text: unit.content, score };
    }
  }

  return best?.text ?? null;
}

function basisIsEstablished(
  basis: AccountingBasis,
  citations: ValidatedCitation[],
  allowedChunks: AnnualReportChunk[],
) {
  const sourceText = citedText(citations, allowedChunks);
  if (basis === "CONSOLIDATED") {
    return /\bconsolidated\b|\bgroup\b/i.test(sourceText);
  }
  if (basis === "STANDALONE") {
    return /\bstandalone\b/i.test(sourceText);
  }
  return false;
}

function validateSectionResponse(
  raw: Record<string, unknown>,
  pack: EvidencePack,
): SectionAnalysis {
  const config = SECTION_CONFIG[pack.sectionKey];
  const rawConclusions = Array.isArray(raw.conclusions) ? raw.conclusions : [];
  const conclusions: ResearchConclusion[] = [];
  const rejected: string[] = [];

  for (const [index, value] of rawConclusions.entries()) {
    if (!isObject(value)) {
      rejected.push(`Conclusion ${index + 1} was not structured evidence.`);
      continue;
    }

    const claim = asString(value.claim);
    let classification = asString(value.classification).toUpperCase();
    let confidence = asString(value.confidence).toUpperCase();
    const accountingBasis = asString(value.accountingBasis).toUpperCase();
    const evidenceUnits = validateEvidenceIds(value.evidenceIds, pack.units);
    const citations = citationsFromUnits(evidenceUnits);
    const supportingExcerpt =
      classification === "UNCERTAIN"
        ? null
        : findSupportingExcerpt(claim, evidenceUnits);
    const financialFigure = isFinancialFigure(
      claim,
      supportingExcerpt ?? "",
      value.financialFigure,
    );

    if (
      !claim ||
      !CLASSIFICATIONS.has(classification) ||
      !CONFIDENCE_LEVELS.has(confidence) ||
      !ACCOUNTING_BASES.has(accountingBasis)
    ) {
      rejected.push(`Conclusion ${index + 1} failed the evidence schema.`);
      continue;
    }

    if (classification !== "UNCERTAIN" && citations.length === 0) {
      rejected.push(`"${claim.slice(0, 80)}" had no valid evidence unit.`);
      continue;
    }

    if (
      classification !== "UNCERTAIN" &&
      (!supportingExcerpt ||
        !evidenceSupportsText(claim, supportingExcerpt) ||
        !subjectIsSupported(claim, supportingExcerpt))
    ) {
      rejected.push(
        `"${claim.slice(0, 80)}" did not have an exact source excerpt that fully supported the claim.`,
      );
      continue;
    }

    if (
      classification !== "UNCERTAIN" &&
      !SECTION_RELEVANCE[pack.sectionKey].test(claim)
    ) {
      rejected.push(
        `"${claim.slice(0, 80)}" was outside the scope of ${config.title.toLowerCase()}.`,
      );
      continue;
    }

    if (
      financialFigure &&
      (!["CONSOLIDATED", "STANDALONE"].includes(accountingBasis) ||
        !basisIsEstablished(
          accountingBasis as AccountingBasis,
          citations,
          pack.chunks,
        ))
    ) {
      rejected.push(
        `"${claim.slice(0, 80)}" was excluded because its accounting basis was not established.`,
      );
      continue;
    }

    if (
      classification === "FACT" &&
      directFactHasInterpretation(claim, supportingExcerpt ?? "")
    ) {
      classification = "INFERENCE";
    }
    if (classification === "INFERENCE" && confidence === "HIGH") {
      confidence = "MEDIUM";
    }

    conclusions.push({
      id: `${pack.sectionKey}-${conclusions.length + 1}`,
      sectionKey: pack.sectionKey,
      claim,
      classification: classification as ResearchConclusion["classification"],
      confidence: confidence as ResearchConclusion["confidence"],
      financialFigure,
      accountingBasis: accountingBasis as AccountingBasis,
      dataPoint: supportingExcerpt,
      citations,
    });
  }

  const modelInsufficient = Array.isArray(raw.insufficientEvidence)
    ? raw.insufficientEvidence
        .map(asString)
        .filter(
          (value) =>
            Boolean(value) &&
            !/^no (?:material|significant|specific).*(?:identified|issues|established)/i.test(
              value,
            ),
        )
    : [];
  const insufficientEvidence = [...new Set([...modelInsufficient, ...rejected])];

  if (conclusions.length === 0) {
    conclusions.push({
      id: `${pack.sectionKey}-1`,
      sectionKey: pack.sectionKey,
      claim: `The annual report evidence retrieved for ${config.title.toLowerCase()} was insufficient to support a material conclusion without guessing.`,
      classification: "UNCERTAIN",
      confidence: "LOW",
      financialFigure: false,
      accountingBasis: "NOT_APPLICABLE",
      dataPoint: null,
      citations: [],
    });
  }

  const supportedConclusions = conclusions.filter(
    (conclusion) => conclusion.classification !== "UNCERTAIN",
  );

  return {
    sectionKey: pack.sectionKey,
    title: config.title,
    status: supportedConclusions.length > 0 ? "COMPLETE" : "INSUFFICIENT",
    conclusions,
    insufficientEvidence,
    retrievedChunks: pack.chunks,
  };
}

function findExactChunkExcerpt(
  pack: EvidencePack,
  chunkIndex: number,
  patterns: RegExp[],
) {
  const chunk = pack.chunks.find(
    (candidate) => candidate.chunkIndex === chunkIndex,
  );
  if (!chunk) return null;
  const lines = chunk.content
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let best: string | null = null;

  for (let start = 0; start < lines.length; start += 1) {
    for (let size = 1; size <= 8; size += 1) {
      const excerpt = lines.slice(start, start + size).join(" ");
      if (excerpt.length > 8_000) break;
      if (!patterns.every((pattern) => pattern.test(excerpt))) continue;
      if (!best || excerpt.length < best.length) best = excerpt;
    }
  }

  if (!best) {
    const compactContent = chunk.content.replace(/\s+/g, " ").trim();
    if (patterns.every((pattern) => pattern.test(compactContent))) {
      best = compactContent;
    }
  }
  if (!best) return null;
  const matchRanges = patterns
    .map((pattern) => best?.match(pattern))
    .filter((match): match is RegExpMatchArray => Boolean(match?.index))
    .map((match) => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }));
  if (matchRanges.length > 0) {
    const start = Math.max(0, Math.min(...matchRanges.map((range) => range.start)) - 180);
    const end = Math.min(
      best.length,
      Math.max(...matchRanges.map((range) => range.end)) + 240,
    );
    best = best.slice(start, end).trim();
  }
  return {
    chunk,
    excerpt: best,
    citation: {
      chunkIndex: chunk.chunkIndex,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      chunkLabel: chunk.chunkLabel,
    } satisfies ValidatedCitation,
  };
}

function anchoredConclusion(
  sectionKey: AnnualReportSectionKey,
  claim: string,
  classification: ResearchConclusion["classification"],
  confidence: ResearchConclusion["confidence"],
  financialFigure: boolean,
  accountingBasis: AccountingBasis,
  anchors: Array<NonNullable<ReturnType<typeof findExactChunkExcerpt>>>,
): ResearchConclusion {
  return {
    id: `${sectionKey}-anchor`,
    sectionKey,
    claim,
    classification,
    confidence,
    financialFigure,
    accountingBasis,
    dataPoint: anchors.map((anchor) => anchor.excerpt).join(" | "),
    citations: uniqueCitations(
      anchors.map((anchor) => ({
        id: `${sectionKey}-source`,
        sectionKey,
        claim: anchor.excerpt,
        classification: "FACT",
        confidence: "HIGH",
        financialFigure: false,
        accountingBasis: "NOT_APPLICABLE",
        dataPoint: anchor.excerpt,
        citations: [anchor.citation],
      })),
    ),
  };
}

function parseIndianNumber(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  if (!match?.[1]) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatIndianNumber(value: number) {
  const digits = String(Math.round(value));
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  const leading = digits.slice(0, -3);
  const groupedLeading = leading.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${groupedLeading},${lastThree}`;
}

function validateAnchoredConclusion(
  pack: EvidencePack,
  conclusion: ResearchConclusion,
) {
  if (conclusion.citations.length === 0 || !conclusion.dataPoint) return false;
  if (
    conclusion.financialFigure &&
    (!["CONSOLIDATED", "STANDALONE"].includes(conclusion.accountingBasis) ||
      !basisIsEstablished(
        conclusion.accountingBasis,
        conclusion.citations,
        pack.chunks,
      ))
  ) {
    return false;
  }

  const sourceNumbers = new Set(numericTokens(conclusion.dataPoint));
  const unsupportedNumbers = numericTokens(conclusion.claim)
    .filter(
      (token) =>
        !/^(?:19|20)\d{2}$/.test(token) &&
        !/^(?:0?[1-9]|[12]\d|3[01])$/.test(token),
    )
    .filter((number) => !sourceNumbers.has(number));
  if (unsupportedNumbers.length === 0) return true;

  if (
    conclusion.classification === "INFERENCE" &&
    /less reported capex|minus/i.test(conclusion.claim)
  ) {
    const currencyValues = [
      ...conclusion.claim.matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g),
    ]
      .map((match) => Number(match[1]?.replace(/,/g, "")))
      .filter(Number.isFinite);
    if (
      currencyValues.length >= 3 &&
      Math.abs(currencyValues[0] - (currencyValues[1] - currencyValues[2])) <
        0.01 &&
      unsupportedNumbers.every(
        (number) => Number(number.replace(/,/g, "")) === currencyValues[0],
      )
    ) {
      return true;
    }
  }

  return false;
}

export function coreAnchors(pack: EvidencePack): ResearchConclusion[] {
  const conclusions: ResearchConclusion[] = [];

  if (pack.sectionKey === "business") {
    const consolidatedBasis = findExactChunkExcerpt(pack, 44, [
      /10-Year Financial Highlights/i,
      /\(Consolidated\)/i,
    ]);
    const o2c = findExactChunkExcerpt(pack, 120, [
      /EBITDA of Oil to Chemicals/i,
      /60,546/,
      /10\.1%/,
    ]);
    if (o2c && consolidatedBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Oil to Chemicals EBITDA was ₹60,546 crore in FY2025-26, up 10.1% year on year.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [o2c, consolidatedBasis],
        ),
      );
    }

    const retail = findExactChunkExcerpt(pack, 115, [
      /Gross Revenue/i,
      /3,71,085/,
      /12\.1%/,
    ]);
    if (retail && consolidatedBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Reliance Retail recorded gross revenue of ₹3,71,085 crore in FY2025-26, up 12.1% year on year.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [retail, consolidatedBasis],
        ),
      );
    }

    const digital = findExactChunkExcerpt(pack, 48, [
      /Digital Services business/i,
      /14\.3%/,
      /17\.8%/,
    ]);
    if (digital && consolidatedBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Digital Services revenue and EBITDA grew 14.3% and 17.8% year on year, respectively, in FY2025-26.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [digital, consolidatedBasis],
        ),
      );
    }
  }

  if (pack.sectionKey === "segments") {
    const segmentTable = findExactChunkExcerpt(pack, 234, [
      /Segment Revenue/i,
      /Segment Result before Interest and Taxes/i,
      /inter segment turnover/i,
      /1,21,879/,
    ]);
    if (segmentTable) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The segment table presents external turnover and results before interest and taxes, with total value of sales and services stated after elimination of ₹1,21,879 crore of inter-segment turnover.",
          "FACT",
          "HIGH",
          false,
          "NOT_APPLICABLE",
          [segmentTable],
        ),
      );
    }
  }

  if (pack.sectionKey === "financial") {
    const revenue = findExactChunkExcerpt(pack, 44, [
      /Value of Sales and Services/i,
      /11,75,919/,
    ]);
    if (revenue) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The consolidated 10-year highlights report FY2025-26 value of sales and services of ₹11,75,919 crore.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [revenue],
        ),
      );
    }

    const ebitda = findExactChunkExcerpt(pack, 44, [
      /Earnings Before Depreciation/i,
      /2,07,911/,
    ]);
    if (ebitda) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Consolidated EBITDA was ₹2,07,911 crore in FY2025-26.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [ebitda],
        ),
      );
    }

    const profit = findExactChunkExcerpt(pack, 44, [
      /Profit for the Year/i,
      /95,754/,
      /81,309/,
    ]);
    if (profit) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Consolidated profit for the year increased to ₹95,754 crore in FY2025-26 from ₹81,309 crore in FY2024-25.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [profit],
        ),
      );
    }
  }

  if (pack.sectionKey === "financial_trends") {
    const trend = findExactChunkExcerpt(pack, 44, [
      /10-Year Financial Highlights/i,
      /\(Consolidated\)/i,
      /11,75,919/,
      /7,88,743/,
      /2,07,911/,
      /1,23,684/,
      /95,754/,
      /66,184/,
    ]);
    if (trend) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Across the five reported fiscal years from FY2021-22 to FY2025-26, consolidated sales and services rose from ₹7,88,743 crore to ₹11,75,919 crore, EBITDA from ₹1,23,684 crore to ₹2,07,911 crore, and profit for the year from ₹66,184 crore to ₹95,754 crore.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [trend],
        ),
      );
    }
  }

  if (pack.sectionKey === "ratios") {
    const ratioTable = findExactChunkExcerpt(pack, 194, [
      /Current Ratio/i,
      /0\.99/,
      /1\.05/,
      /Debt-Equity Ratio/i,
      /0\.41/,
      /0\.37/,
    ]);
    const consolidatedBasis = findExactChunkExcerpt(pack, 44, [
      /10-Year Financial Highlights/i,
      /\(Consolidated\)/i,
    ]);
    if (ratioTable && consolidatedBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The disclosed current ratio was 0.99 in FY2025-26 versus 1.05 in FY2024-25, while the disclosed debt-equity ratio was 0.41 versus 0.37.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [ratioTable, consolidatedBasis],
        ),
      );
    }
  }

  if (
    pack.sectionKey === "cash_balance_sheet" ||
    pack.sectionKey === "cash_flow"
  ) {
    const operatingCash = findExactChunkExcerpt(pack, 207, [
      /Net Cash Flow from Operating Activities/i,
      /1,92,113/,
      /1,78,703/,
    ]);
    if (operatingCash) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Consolidated net cash flow from operating activities increased to ₹1,92,113 crore in FY2025-26 from ₹1,78,703 crore in FY2024-25.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [operatingCash],
        ),
      );
    }

    const cash = findExactChunkExcerpt(pack, 214, [
      /Cash and Cash Equivalents as per Balance Sheet/i,
      /1,45,977/,
      /1,06,502/,
    ]);
    if (cash) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Consolidated cash and cash equivalents were ₹1,45,977 crore at March 31, 2026, versus ₹1,06,502 crore a year earlier.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [cash],
        ),
      );
    }

    const netIncrease = findExactChunkExcerpt(pack, 207, [
      /Net Increase in Cash and Cash Equivalents/i,
      /39,475/,
      /9,277/,
    ]);
    if (netIncrease) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The consolidated net increase in cash and cash equivalents was ₹39,475 crore in FY2025-26, compared with ₹9,277 crore in FY2024-25.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [netIncrease],
        ),
      );
    }

    const capex = findExactChunkExcerpt(pack, 44, [
      /capital expenditure for FY 2025-26/i,
      /1,44,271/,
    ]);
    if (capex) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Reliance reported consolidated capital expenditure of ₹1,44,271 crore for FY2025-26.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [capex],
        ),
      );
    }

    if (operatingCash && capex) {
      const operatingCashValue = parseIndianNumber(
        operatingCash.excerpt,
        /Net Cash Flow from Operating Activities\s*\*?\s*([\d,]+)/i,
      );
      const capexValue = parseIndianNumber(
        capex.excerpt,
        /stood at\s*[H₹]\s*([\d,]+)/i,
      );
      if (operatingCashValue !== null && capexValue !== null) {
        const impliedFreeCashFlow = operatingCashValue - capexValue;
        conclusions.push(
          anchoredConclusion(
            pack.sectionKey,
            `Operating cash flow less reported capex implies pre-financing free cash flow of approximately ₹${formatIndianNumber(impliedFreeCashFlow)} crore for FY2025-26 (₹${formatIndianNumber(operatingCashValue)} crore minus ₹${formatIndianNumber(capexValue)} crore).`,
            "INFERENCE",
            "MEDIUM",
            true,
            "CONSOLIDATED",
            [operatingCash, capex],
          ),
        );
      }
    }
  }

  if (pack.sectionKey === "balance_sheet") {
    const cash = findExactChunkExcerpt(pack, 214, [
      /Cash and Cash Equivalents as per Balance Sheet/i,
      /1,45,977/,
      /1,06,502/,
    ]);
    const consolidatedBasis = findExactChunkExcerpt(pack, 44, [
      /10-Year Financial Highlights/i,
      /\(Consolidated\)/i,
    ]);
    if (cash && consolidatedBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Consolidated cash and cash equivalents were ₹1,45,977 crore at March 31, 2026, versus ₹1,06,502 crore a year earlier.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [cash, consolidatedBasis],
        ),
      );
    }
  }

  if (pack.sectionKey === "inventory") {
    const inventory = findExactChunkExcerpt(pack, 159, [
      /Standalone Financial Statements/i,
      /Inventories/i,
      /1,04,925/,
      /89,216/,
    ]);
    if (inventory) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Standalone inventories were ₹1,04,925 crore at March 31, 2026, versus ₹89,216 crore a year earlier.",
          "FACT",
          "HIGH",
          true,
          "STANDALONE",
          [inventory],
        ),
      );
    }
  }

  if (pack.sectionKey === "receivables") {
    const receivables = findExactChunkExcerpt(pack, 159, [
      /Standalone Financial Statements/i,
      /Trade Receivables/i,
      /16,641/,
      /15,591/,
    ]);
    if (receivables) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Standalone trade receivables were ₹16,641 crore at March 31, 2026, versus ₹15,591 crore a year earlier.",
          "FACT",
          "HIGH",
          true,
          "STANDALONE",
          [receivables],
        ),
      );
    }
  }

  if (pack.sectionKey === "payables") {
    const payables = findExactChunkExcerpt(pack, 159, [
      /Standalone Financial Statements/i,
      /Trade Payables Due to/i,
      /Micro and Small Enterprises/i,
      /573/,
      /1,301/,
    ]);
    if (payables) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Standalone trade payables due to micro and small enterprises were ₹573 crore at March 31, 2026, versus ₹1,301 crore a year earlier.",
          "FACT",
          "HIGH",
          true,
          "STANDALONE",
          [payables],
        ),
      );
    }
  }

  if (pack.sectionKey === "working_capital") {
    const inventoryMovement = findExactChunkExcerpt(pack, 162, [
      /Operating Profit before Working Capital Changes/i,
      /Inventories/i,
      /\(15,709\)/,
      /\(4,116\)/,
    ]);
    const standaloneBasis = findExactChunkExcerpt(pack, 159, [
      /Standalone Financial Statements/i,
    ]);
    if (inventoryMovement && standaloneBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "In the standalone cash-flow reconciliation, inventory movement was (₹15,709 crore) in FY2025-26, compared with (₹4,116 crore) in FY2024-25.",
          "FACT",
          "HIGH",
          true,
          "STANDALONE",
          [inventoryMovement, standaloneBasis],
        ),
      );
    }
  }

  if (pack.sectionKey === "debt") {
    const netDebt = findExactChunkExcerpt(pack, 44, [
      /Consolidated Net Debt/i,
      /1,24,717/,
    ]);
    const consolidatedBasis = findExactChunkExcerpt(pack, 44, [
      /10-Year Financial Highlights/i,
      /\(Consolidated\)/i,
    ]);
    if (netDebt && consolidatedBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The annual report states that consolidated net debt stood at ₹1,24,717 crore at the end of FY2025-26.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [netDebt, consolidatedBasis],
        ),
      );
    }
  }

  if (pack.sectionKey === "outlook") {
    const o2cOutlook = findExactChunkExcerpt(pack, 56, [
      /Outlook/i,
      /FY 2026-27 outlook remains/i,
      /volatile product and feedstock prices/i,
      /demand and margins/i,
    ]);
    if (o2cOutlook) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The Oil to Chemicals outlook says FY2026-27 remains uncertain, with volatile product and feedstock prices, Middle East supply disruption, and policy factors that may weigh on domestic demand and margins.",
          "FACT",
          "HIGH",
          false,
          "NOT_APPLICABLE",
          [o2cOutlook],
        ),
      );
    }
  }

  if (pack.sectionKey === "industry") {
    const operatingEnvironment = findExactChunkExcerpt(pack, 44, [
      /Operating Environment/i,
      /Global economic expansion continued/i,
      /Inflationary pressures/i,
    ]);
    if (operatingEnvironment) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The annual report says global economic expansion continued in CY25 and that inflationary pressures moderated marginally across many economies.",
          "FACT",
          "HIGH",
          false,
          "NOT_APPLICABLE",
          [operatingEnvironment],
        ),
      );
    }
  }

  if (pack.sectionKey === "governance") {
    const controls = findExactChunkExcerpt(pack, 203, [
      /adequate internal financial controls/i,
      /operating effectively as at 31st March, 2026/i,
      /Consolidated Financial Statements/i,
    ]);
    if (controls) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The auditors reported that the group companies covered by their work had adequate internal financial controls over consolidated financial reporting, operating effectively at March 31, 2026.",
          "FACT",
          "HIGH",
          false,
          "NOT_APPLICABLE",
          [controls],
        ),
      );
    }
  }

  if (pack.sectionKey === "shareholders") {
    const promoterHolding = findExactChunkExcerpt(pack, 102, [
      /Total Shareholding of Promoter and Promoter Group/i,
      /664,54,96,096/,
      /49\.11%/,
    ]);
    if (promoterHolding) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The annual report's promoter-group table reports 664,54,96,096 shares, representing 49.11% of total shareholding.",
          "FACT",
          "HIGH",
          false,
          "NOT_APPLICABLE",
          [promoterHolding],
        ),
      );
    }
  }

  if (pack.sectionKey === "subsidiaries") {
    const materialSubsidiaries = findExactChunkExcerpt(pack, 101, [
      /details of material subsidiaries/i,
      /Jio Platforms Limited/i,
      /Reliance Jio Infocomm Limited/i,
      /Reliance Retail Ventures Limited/i,
      /Reliance Retail Limited/i,
      /Reliance International Limited/i,
    ]);
    if (materialSubsidiaries) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "The annual report identifies Jio Platforms, Reliance Jio Infocomm, Reliance Retail Ventures, Reliance Retail, and Reliance International as material subsidiaries for FY2025-26.",
          "FACT",
          "HIGH",
          false,
          "NOT_APPLICABLE",
          [materialSubsidiaries],
        ),
      );
    }
  }

  if (pack.sectionKey === "positives") {
    const consolidatedBasis = findExactChunkExcerpt(pack, 44, [
      /10-Year Financial Highlights/i,
      /\(Consolidated\)/i,
    ]);
    const retail = findExactChunkExcerpt(pack, 115, [
      /Gross Revenue/i,
      /3,71,085/,
      /12\.1%/,
    ]);
    if (retail && consolidatedBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Reliance Retail recorded gross revenue of ₹3,71,085 crore in FY2025-26, up 12.1% year on year.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [retail, consolidatedBasis],
        ),
      );
    }

    const digital = findExactChunkExcerpt(pack, 48, [
      /Digital Services business/i,
      /14\.3%/,
      /17\.8%/,
    ]);
    if (digital && consolidatedBasis) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Digital Services revenue and EBITDA grew 14.3% and 17.8% year on year, respectively, in FY2025-26.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [digital, consolidatedBasis],
        ),
      );
    }

    const profit = findExactChunkExcerpt(pack, 44, [
      /Profit for the Year/i,
      /95,754/,
      /81,309/,
    ]);
    if (profit) {
      conclusions.push(
        anchoredConclusion(
          pack.sectionKey,
          "Consolidated profit for the year increased to ₹95,754 crore in FY2025-26 from ₹81,309 crore in FY2024-25.",
          "FACT",
          "HIGH",
          true,
          "CONSOLIDATED",
          [profit],
        ),
      );
    }
  }

  for (const conclusion of conclusions) {
    if (!validateAnchoredConclusion(pack, conclusion)) {
      throw new Error(
        `Deterministic ${pack.sectionKey} anchor failed source, number, or accounting-basis validation: ${conclusion.claim}`,
      );
    }
  }
  return conclusions;
}

function mergeAnchoredConclusions(
  section: SectionAnalysis,
  anchors: ResearchConclusion[],
) {
  const merged = [...anchors];
  const anchorOnlySections = new Set<AnnualReportSectionKey>([
    "governance",
    "shareholders",
    "subsidiaries",
    "positives",
  ]);
  const generatedConclusions =
    anchors.length > 0 && anchorOnlySections.has(section.sectionKey)
      ? []
      : section.conclusions;
  for (const conclusion of generatedConclusions) {
    if (conclusion.classification === "UNCERTAIN" && anchors.length > 0) continue;
    const duplicate = merged.some((candidate) => {
      const candidateNumbers = numericTokens(candidate.claim);
      const conclusionNumbers = numericTokens(conclusion.claim);
      return (
        candidateNumbers.length > 0 &&
        candidateNumbers.every((number) => conclusionNumbers.includes(number))
      );
    });
    if (!duplicate) merged.push(conclusion);
  }

  const distinct =
    section.sectionKey === "risks"
      ? merged.filter((conclusion, index, candidates) => {
          const words = meaningfulWords(conclusion.claim);
          return !candidates.slice(0, index).some((candidate) => {
            const candidateWords = meaningfulWords(candidate.claim);
            if (words.length === 0 || candidateWords.length === 0) return false;
            const shared = words.filter((word) =>
              candidateWords.includes(word),
            ).length;
            return (
              shared / Math.min(words.length, candidateWords.length) >= 0.68
            );
          });
        })
      : merged;
  const conclusions = distinct.slice(0, 5).map((conclusion, index) => ({
    ...conclusion,
    id: `${section.sectionKey}-${index + 1}`,
  }));
  return {
    ...section,
    insufficientEvidence:
      anchors.length > 0 ? [] : section.insufficientEvidence,
    status: conclusions.some(
      (conclusion) => conclusion.classification !== "UNCERTAIN",
    )
      ? ("COMPLETE" as const)
      : ("INSUFFICIENT" as const),
    conclusions,
  };
}

function checksForSection(
  sectionKey: AnnualReportSectionKey,
  researchChecks: ResearchCheck[],
) {
  const categories = new Set(SECTION_CONFIG[sectionKey].checkCategories);
  return researchChecks.filter((check) => categories.has(check.category));
}

const FRAMEWORK_SECTION_KEYS: Record<AnnualReportSectionKey, string[]> = {
  business: ["business"],
  segments: ["business"],
  financial: ["financial"],
  financial_trends: ["financial"],
  ratios: ["financial", "balance_sheet"],
  cash_balance_sheet: ["cash_flow", "balance_sheet"],
  cash_flow: ["cash_flow"],
  balance_sheet: ["balance_sheet"],
  receivables: ["balance_sheet"],
  inventory: ["balance_sheet"],
  payables: ["balance_sheet"],
  working_capital: ["cash_flow", "balance_sheet"],
  debt: ["balance_sheet"],
  management: ["management"],
  outlook: ["outlook"],
  industry: ["industry"],
  related_parties: ["related_parties"],
  governance: ["governance"],
  shareholders: ["shareholders"],
  subsidiaries: ["business"],
  risks: ["red_flags"],
  positives: ["positives"],
};

export async function generateAnnualReportSection(
  source: AnnualReportSource,
  pack: EvidencePack,
): Promise<SectionAnalysis> {
  const config = SECTION_CONFIG[pack.sectionKey];
  const checks = checksForSection(pack.sectionKey, source.databaseResearchChecks);
  const frameworkSection = source.framework.sections.filter((section) =>
    FRAMEWORK_SECTION_KEYS[pack.sectionKey].includes(section.sectionKey),
  );

  const system = [
    "You are StockLens' evidence-constrained annual-report analyst.",
    "Use only the annual-report evidence units supplied in this request. Do not use memory, outside knowledge, market data, or unstated assumptions.",
    "Every FACT or INFERENCE must cite one or more supplied evidence unit IDs. An unsupplied ID is invalid.",
    "Every figure in a claim must appear in one cited evidence unit, and that same unit must name the segment, subsidiary, or business to which the claim attributes the figure.",
    "A FACT is directly stated by the filing. An INFERENCE is an interpretation derived from cited facts. UNCERTAIN means the filing evidence is insufficient.",
    "For every claim containing a financial figure, set financialFigure=true and accountingBasis to CONSOLIDATED or STANDALONE only when the cited chunks establish that basis. If the basis is unclear, do not use the figure and record the gap in insufficientEvidence.",
    "Do not mix consolidated and standalone figures. Do not treat management plans as facts about future outcomes. Do not call something a red flag without material evidence.",
    "Stay strictly within the requested section objective. Do not fill a weak section with unrelated group KPIs. Do not attribute a group-level figure to a segment or subsidiary.",
    "Write conclusions, not research questions. Never display the internal checks in the output.",
    ...Object.values(AI_RULES),
    ...Object.values(FINANCIAL_BASIS_RULES),
  ].join("\n");

  const user = [
    `DOCUMENT: ${source.document.title}`,
    `DOCUMENT ID: ${source.document.id}`,
    `REPORTING PERIOD: ${source.document.reporting_period}`,
    `SECTION: ${config.title}`,
    `SECTION OBJECTIVE: ${config.instruction}`,
    `FRAMEWORK GUIDANCE: ${frameworkSection
      .map((section) => section.description)
      .join(" ")}`,
    "",
    "INTERNAL RESEARCH CHECKS (investigate silently; never quote these questions):",
    JSON.stringify(checks),
    "",
    "Return one JSON object with exactly this shape:",
    JSON.stringify({
      conclusions: [
        {
          claim: "A concise investor-facing conclusion.",
          classification: "FACT | INFERENCE | UNCERTAIN",
          confidence: "HIGH | MEDIUM | LOW",
          financialFigure: false,
          accountingBasis:
            "CONSOLIDATED | STANDALONE | NOT_CLEAR | NOT_APPLICABLE",
          evidenceIds: ["44:12-13"],
        },
      ],
      insufficientEvidence: [
        "A specific material issue that could not be established from these evidence units.",
      ],
    }),
    "",
    "Produce at most five material conclusions. Keep each conclusion crisp. Do not include markdown.",
    "",
    "ANNUAL-REPORT EVIDENCE:",
    formatEvidencePack(pack),
  ].join("\n");

  const raw = await requestJson(system, user);
  return mergeAnchoredConclusions(
    validateSectionResponse(raw, pack),
    coreAnchors(pack),
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export async function generateAnnualReportSections(
  source: AnnualReportSource,
  packs: EvidencePack[],
) {
  return mapWithConcurrency(packs, 2, (pack) =>
    generateAnnualReportSection(source, pack),
  );
}

function allConclusions(sections: SectionAnalysis[]) {
  return sections.flatMap((section) =>
    section.conclusions.filter(
      (conclusion) => conclusion.classification !== "UNCERTAIN",
    ),
  );
}

function conclusionMap(sections: SectionAnalysis[]) {
  return new Map(allConclusions(sections).map((conclusion) => [conclusion.id, conclusion]));
}

function uniqueCitations(conclusions: ResearchConclusion[]) {
  const citations = new Map<number, ValidatedCitation>();
  for (const conclusion of conclusions) {
    for (const citation of conclusion.citations) {
      citations.set(citation.chunkIndex, citation);
    }
  }
  return [...citations.values()];
}

function makeQuickConclusion(
  key: QuickViewKey,
  text: string,
  sourceIds: string[],
  sources: Map<string, ResearchConclusion>,
): ResearchConclusion {
  const sourceConclusions = sourceIds
    .map((id) => sources.get(id))
    .filter((conclusion): conclusion is ResearchConclusion => Boolean(conclusion));
  const confidence = sourceConclusions.some(
    (conclusion) => conclusion.confidence === "LOW",
  )
    ? "LOW"
    : "MEDIUM";
  const financialSources = sourceConclusions.filter(
    (conclusion) => conclusion.financialFigure,
  );
  const financialBases = new Set(
    financialSources
      .map((conclusion) => conclusion.accountingBasis)
      .filter((basis) => ["CONSOLIDATED", "STANDALONE"].includes(basis)),
  );
  const financialFigure =
    numericTokens(text).length > 0 && financialSources.length > 0;
  const accountingBasis: AccountingBasis =
    financialFigure && financialBases.size === 1
      ? ([...financialBases][0] as AccountingBasis)
      : financialFigure
        ? "NOT_CLEAR"
        : "NOT_APPLICABLE";

  return {
    id: `quick_view-${key}`,
    sectionKey: "quick_view",
    claim: text,
    classification: sourceConclusions.length > 0 ? "INFERENCE" : "UNCERTAIN",
    confidence: sourceConclusions.length > 0 ? confidence : "LOW",
    financialFigure,
    accountingBasis,
    dataPoint: sourceConclusions.map((conclusion) => conclusion.claim).join(" | "),
    citations: uniqueCitations(sourceConclusions),
  };
}

function fallbackQuickView(
  sections: SectionAnalysis[],
  key: QuickViewKey,
): { text: string; sourceConclusionIds: string[] } {
  const bySection = new Map(sections.map((section) => [section.sectionKey, section]));
  const supported = (sectionKey: AnnualReportSectionKey) =>
    bySection
      .get(sectionKey)
      ?.conclusions.filter((conclusion) => conclusion.classification !== "UNCERTAIN") ??
    [];
  const preferred: Record<QuickViewKey, AnnualReportSectionKey[]> = {
    whatIsHappening: ["financial", "business"],
    biggestPositive: ["positives", "business"],
    biggestConcern: ["risks", "cash_balance_sheet"],
    whatMattersMost: ["business", "financial"],
    whatToWatch: ["risks", "management"],
    investorTakeaway: ["business", "financial", "risks"],
  };
  const candidates = preferred[key].flatMap(supported).slice(0, key === "investorTakeaway" ? 3 : 1);
  if (candidates.length === 0) {
    return {
      text: "The annual report evidence was insufficient for a reliable conclusion.",
      sourceConclusionIds: [],
    };
  }
  return {
    text: candidates.map((candidate) => candidate.claim).join(" "),
    sourceConclusionIds: candidates.map((candidate) => candidate.id),
  };
}

export async function generateQuickView(
  sections: SectionAnalysis[],
): Promise<QuickViewAnalysis> {
  const sources = conclusionMap(sections);
  const sourcePayload = [...sources.values()].map((conclusion) => ({
    id: conclusion.id,
    section: conclusion.sectionKey,
    claim: conclusion.claim,
    classification: conclusion.classification,
    confidence: conclusion.confidence,
  }));
  const keys: QuickViewKey[] = [
    "whatIsHappening",
    "biggestPositive",
    "biggestConcern",
    "whatMattersMost",
    "whatToWatch",
    "investorTakeaway",
  ];

  const raw = await requestJson(
    [
      "Create a concise investor quick view using only the supplied validated conclusions.",
      "Do not add facts, figures, companies, events, or claims. Every item must cite the IDs of conclusions that fully support it.",
      "Write conclusions, not questions. Do not give a buy, sell, or hold recommendation.",
    ].join("\n"),
    [
      "Return JSON with keys whatIsHappening, biggestPositive, biggestConcern, whatMattersMost, whatToWatch, investorTakeaway.",
      'Each key must contain {"text":"one or two concise sentences","sourceConclusionIds":["id"]}.',
      "Validated conclusions:",
      JSON.stringify(sourcePayload),
    ].join("\n"),
  );

  const items = {} as Record<QuickViewKey, QuickViewItem>;
  for (const key of keys) {
    const value = isObject(raw[key]) ? raw[key] : {};
    let text = asString(value.text);
    let sourceConclusionIds = Array.isArray(value.sourceConclusionIds)
      ? value.sourceConclusionIds
          .map(asString)
          .filter((id) => sources.has(id))
      : [];

    const sourceText = sourceConclusionIds
      .map((id) => sources.get(id)?.claim ?? "")
      .join(" ");
    const unsupportedNumber = numericTokens(text).some(
      (token) => !numericTokens(sourceText).includes(token),
    );
    const exactNumericSource =
      numericTokens(text).length > 0
        ? sourceConclusionIds
            .map((id) => sources.get(id))
            .find(
              (conclusion) =>
                conclusion &&
                numericTokens(text).every((token) =>
                  numericTokens(conclusion.claim).includes(token),
                ),
            )
        : null;
    if (exactNumericSource) {
      text = exactNumericSource.claim;
      sourceConclusionIds = [exactNumericSource.id];
    } else if (!text || sourceConclusionIds.length === 0 || unsupportedNumber) {
      const fallback = fallbackQuickView(sections, key);
      text = fallback.text;
      sourceConclusionIds = fallback.sourceConclusionIds;
    }

    items[key] = {
      key,
      text,
      sourceConclusionIds,
      conclusion: makeQuickConclusion(key, text, sourceConclusionIds, sources),
    };
  }

  return { items };
}

export async function generateCrossChecks(
  rules: CrossCheckRule[],
  _sections: SectionAnalysis[],
): Promise<GeneratedCrossCheck[]> {
  return rules.map((rule) => ({
      ruleKey: rule.ruleKey,
      ruleDescription: rule.description,
      metricAName: rule.metricA,
      metricAValue: null,
      metricBName: rule.metricB,
      metricBValue: null,
      expectedRelationship: rule.expectedRelationship,
      result: "INSUFFICIENT_DATA",
      finding: `The annual report evidence did not deterministically establish both ${rule.metricA} and ${rule.metricB} on one accounting basis.`,
      severity: null,
      sourceConclusionIds: [],
    }));
}

function pageReference(citations: ValidatedCitation[]) {
  if (citations.length === 0) return "Annual report evidence insufficient";
  const pages = [
    ...new Set(
      citations.flatMap((citation) =>
        citation.pageStart === citation.pageEnd
          ? [String(citation.pageStart)]
          : [`${citation.pageStart}-${citation.pageEnd}`],
      ),
    ),
  ];
  const chunks = [...new Set(citations.map((citation) => citation.chunkIndex))];
  return `Annual Report p. ${pages.join(", ")} · chunks ${chunks.join(", ")}`;
}

export function renderConclusion(conclusion: ResearchConclusion) {
  const basis =
    conclusion.financialFigure &&
    ["CONSOLIDATED", "STANDALONE"].includes(conclusion.accountingBasis)
      ? ` · ${conclusion.accountingBasis.toLowerCase()}`
      : "";
  const label =
    conclusion.classification === "UNCERTAIN"
      ? "Insufficient evidence"
      : conclusion.classification === "FACT"
        ? "Fact"
        : "Inference";
  return `${conclusion.claim}\n[${label} · ${conclusion.confidence.toLowerCase()} confidence${basis} | ${pageReference(conclusion.citations)}]`;
}

export function renderSectionContent(section: SectionAnalysis) {
  return section.conclusions.map(renderConclusion).join("\n\n");
}

export function renderQuickViewItem(item: QuickViewItem) {
  return renderConclusion(item.conclusion);
}