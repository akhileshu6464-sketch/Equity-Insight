/**
 * Multi-Agent Engine — new entry point that runs the 7 specialists,
 * validates, and persists the professional Initiating Coverage report.
 *
 * Preserves the existing:
 *   - annual-report-source loader (Supabase reads: company/document/chunks/framework)
 *   - retrieval (evidence packs)
 *   - research-framework checklist
 *
 * Replaces the SINGLE agent in annual-report-generator.ts with the
 * MasterAgent + 7 specialists + QA validator.
 */

import { logger } from "../../logger.js";
import {
  loadRelianceAnnualReportSource,
  RELIANCE_ANNUAL_REPORT_ID,
  RELIANCE_COMPANY_ID,
} from "../annual-report-source.js";
import { runMultiAgentResearch } from "./master.js";
import { persistMultiAgentRun } from "./persistence.js";

export interface MultiAgentEngineResult {
  status: "COMPLETE";
  companyId: string;
  documentId: string;
  title: string;
  reportingPeriod: string;
  totalFindings: number;
  supportedFindings: number;
  specialists: Array<{
    key: string;
    findings: number;
    insufficient: number;
    durationMs: number;
  }>;
  qa: {
    passed: number;
    failed: number;
    contradictions: number;
    missingChecklistQuestions: string[];
  };
  persistence: {
    evidenceRows: number;
    researchRows: number;
  };
  reportSectionsWritten: string[];
}

export async function runRelianceMultiAgentResearch(): Promise<MultiAgentEngineResult> {
  const source = await loadRelianceAnnualReportSource();

  logger.info(
    {
      companyId: RELIANCE_COMPANY_ID,
      documentId: RELIANCE_ANNUAL_REPORT_ID,
      chunks: source.chunks.length,
    },
    "Multi-agent research starting for Reliance",
  );

  const run = await runMultiAgentResearch(source, {
    onProgress: (event) =>
      logger.info(event, `Multi-agent phase ${event.phase}`),
  });

  const persistence = await persistMultiAgentRun(source, run.specialists, run.qa, run.synthesis);

  const specialists = run.specialists.map((s) => ({
    key: s.specialist,
    findings: s.findings.length,
    insufficient: s.questionsInsufficient.length,
    durationMs: s.durationMs,
  }));

  logger.info(
    {
      totalFindings: run.totalFindings,
      supportedFindings: run.supportedFindings,
      qaFailed: run.qa.failed,
    },
    "Multi-agent research complete",
  );

  return {
    status: "COMPLETE",
    companyId: RELIANCE_COMPANY_ID,
    documentId: RELIANCE_ANNUAL_REPORT_ID,
    title: source.document.title,
    reportingPeriod: source.document.reporting_period ?? "",
    totalFindings: run.totalFindings,
    supportedFindings: run.supportedFindings,
    specialists,
    qa: {
      passed: run.qa.passed,
      failed: run.qa.failed,
      contradictions: run.qa.contradictions.length,
      missingChecklistQuestions: run.qa.missingChecklistQuestions,
    },
    persistence,
    reportSectionsWritten: run.synthesis.sections.map((s) => s.sectionKey),
  };
}
