import type {
  ConfidenceLevel,
  CrossCheckResult,
  EvidenceType,
  SeverityLevel,
} from "../evidence.js";
import type {
  AnnualReportChunk,
  AnnualReportSectionKey,
} from "./annual-report-source.js";

export type AccountingBasis =
  | "CONSOLIDATED"
  | "STANDALONE"
  | "NOT_CLEAR"
  | "NOT_APPLICABLE";

export interface ValidatedCitation {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  chunkLabel: string;
}

export interface ResearchConclusion {
  id: string;
  sectionKey: AnnualReportSectionKey | "quick_view";
  claim: string;
  classification: EvidenceType;
  confidence: ConfidenceLevel;
  financialFigure: boolean;
  accountingBasis: AccountingBasis;
  dataPoint: string | null;
  citations: ValidatedCitation[];
}

export interface SectionAnalysis {
  sectionKey: AnnualReportSectionKey;
  title: string;
  status: "COMPLETE" | "INSUFFICIENT";
  conclusions: ResearchConclusion[];
  insufficientEvidence: string[];
  retrievedChunks: AnnualReportChunk[];
}

export type QuickViewKey =
  | "whatIsHappening"
  | "biggestPositive"
  | "biggestConcern"
  | "whatMattersMost"
  | "whatToWatch"
  | "investorTakeaway";

export interface QuickViewItem {
  key: QuickViewKey;
  text: string;
  sourceConclusionIds: string[];
  conclusion: ResearchConclusion;
}

export interface QuickViewAnalysis {
  items: Record<QuickViewKey, QuickViewItem>;
}

export interface GeneratedCrossCheck {
  ruleKey: string;
  ruleDescription: string;
  metricAName: string;
  metricAValue: number | null;
  metricBName: string;
  metricBValue: number | null;
  expectedRelationship: string;
  result: CrossCheckResult;
  finding: string;
  severity: SeverityLevel | null;
  sourceConclusionIds: string[];
}