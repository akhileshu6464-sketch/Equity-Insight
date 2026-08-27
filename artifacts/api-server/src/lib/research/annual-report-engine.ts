import { logger } from "../logger.js";
import {
  generateAnnualReportSections,
  generateCrossChecks,
  generateQuickView,
} from "./annual-report-generator.js";
import {
  acquireResearchRunLock,
  completeResearchJob,
  createResearchJob,
  failResearchJob,
  publishAnnualReportResearch,
  releaseResearchRunLock,
} from "./annual-report-persistence.js";
import {
  EXPECTED_CHUNK_COUNT,
  EXPECTED_PAGE_COUNT,
  loadRelianceAnnualReportSource,
  RELIANCE_ANNUAL_REPORT_ID,
  RELIANCE_COMPANY_ID,
  retrieveAnnualReportEvidence,
} from "./annual-report-source.js";

export async function runRelianceAnnualReportResearch() {
  const lockOwner = await acquireResearchRunLock();
  let jobId: string | null = null;

  try {
    const source = await loadRelianceAnnualReportSource();
    const evidencePacks = retrieveAnnualReportEvidence(source);
    jobId = await createResearchJob();

    logger.info(
      {
        jobId,
        companyId: RELIANCE_COMPANY_ID,
        documentId: RELIANCE_ANNUAL_REPORT_ID,
        chunks: source.chunks.length,
        pages: EXPECTED_PAGE_COUNT,
      },
      "Reliance annual-report research started",
    );

    const sections = await generateAnnualReportSections(source, evidencePacks);
    const quickView = await generateQuickView(sections);
    const crossChecks = await generateCrossChecks(
      source.databaseCrossCheckRules,
      sections,
    );
    const supportedConclusionCount = sections
      .flatMap((section) => section.conclusions)
      .filter((conclusion) => conclusion.classification !== "UNCERTAIN").length;
    const completedSectionKeys = new Set(
      sections
        .filter((section) => section.status === "COMPLETE")
        .map((section) => section.sectionKey),
    );
    if (
      sections.length !== evidencePacks.length ||
      crossChecks.length !== source.databaseCrossCheckRules.length
    ) {
      throw new Error("Annual-report evidence checks did not produce a complete result set");
    }
    if (
      supportedConclusionCount < 24 ||
      completedSectionKeys.size < 16
    ) {
      throw new Error(
        `Annual-report publication quality gate failed: ${supportedConclusionCount} supported conclusions across ${completedSectionKeys.size} complete sections`,
      );
    }

    const publication = await publishAnnualReportResearch(
      source,
      sections,
      quickView,
      crossChecks,
    );
    const insufficientSections = sections
      .filter((section) => section.status === "INSUFFICIENT")
      .map((section) => section.sectionKey);
    const completedSections = [
      "quick_view",
      ...sections
        .filter((section) => section.status === "COMPLETE")
        .map((section) => section.sectionKey),
      "takeaway",
    ];

    await completeResearchJob(jobId, completedSections, insufficientSections);

    return {
      status: "COMPLETE" as const,
      jobId,
      source: {
        companyId: RELIANCE_COMPANY_ID,
        documentId: RELIANCE_ANNUAL_REPORT_ID,
        title: source.document.title,
        reportingPeriod: source.document.reporting_period,
        chunkCount: EXPECTED_CHUNK_COUNT,
        pageCount: EXPECTED_PAGE_COUNT,
        externalSourcesUsed: 0,
      },
      framework: source.framework.industryType,
      retrieval: evidencePacks.map((pack) => ({
        section: pack.sectionKey,
        chunkIndexes: pack.chunks.map((chunk) => chunk.chunkIndex),
        pageRanges: pack.chunks.map((chunk) => [chunk.pageStart, chunk.pageEnd]),
      })),
      sections: sections.map((section) => ({
        key: section.sectionKey,
        status: section.status,
        conclusionCount: section.conclusions.length,
        insufficientEvidence: section.insufficientEvidence,
      })),
      insufficientSections,
      crossChecks: crossChecks.map((crossCheck) => ({
        ruleKey: crossCheck.ruleKey,
        result: crossCheck.result,
      })),
      publication,
    };
  } catch (error) {
    logger.error({ error, jobId }, "Reliance annual-report research failed");
    if (jobId) {
      try {
        await failResearchJob(jobId, error);
      } catch (jobError) {
        logger.error(
          { jobError, jobId },
          "Could not mark annual-report research job failed",
        );
      }
    }
    throw error;
  } finally {
    try {
      await releaseResearchRunLock(lockOwner);
    } catch (lockError) {
      logger.error(
        { lockError },
        "Could not release the annual-report research run lock",
      );
    }
  }
}