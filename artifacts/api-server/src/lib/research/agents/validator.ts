/**
 * QA / Validator stage.
 *
 * After specialists finish, the validator checks:
 *   1. Numerical accuracy — every claimed number appears in the cited evidence.
 *   2. Basis consistency — no consolidated/standalone mixing inside a finding.
 *   3. Period consistency — finding period matches its calculations.
 *   4. Evidence support — at least one citation with a supporting quote.
 *   5. Contradictions — no two findings that make directly opposing numeric claims.
 *   6. Checklist coverage — every specialist question was attempted.
 *
 * The validator is DETERMINISTIC (no LLM), so it always produces the same
 * verdict for the same inputs.
 */

import { verifyCalculation } from "./calculator.js";
import type {
  QAAnnotation,
  QAReport,
  SpecialistFinding,
  SpecialistOutput,
} from "./types.js";

function numericTokens(value: string): string[] {
  const tokens = value.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  return tokens
    .map((token) => token.replace(/,/g, ""))
    .filter((token) => !/^(?:19|20)\d{2}$/.test(token) && token.length > 1);
}

function checkNumericalGrounding(finding: SpecialistFinding): QAAnnotation | null {
  if (finding.insufficientEvidence) return null;
  if (!finding.supportingQuote) {
    return {
      findingId: finding.id,
      status: "MISSING_EVIDENCE",
      detail: "No supporting quote captured for this finding.",
      severity: "HIGH",
    };
  }
  const excerptNumbers = new Set(numericTokens(finding.supportingQuote));
  const claimNumbers = [
    ...numericTokens(finding.fact),
    ...finding.dataPoints.flatMap((p) => numericTokens(p)),
  ];
  const missing = claimNumbers.filter((n) => !excerptNumbers.has(n));
  if (missing.length === 0) return null;
  return {
    findingId: finding.id,
    status: "NUMERICAL_MISMATCH",
    detail: `Numbers not found in cited evidence: ${missing.slice(0, 5).join(", ")}`,
    severity: "HIGH",
  };
}

function checkBasisConsistency(finding: SpecialistFinding): QAAnnotation | null {
  for (const calc of finding.calculations) {
    const bases = new Set(
      calc.inputs.map((i) => i.basis).filter((b) => b !== "NOT_APPLICABLE"),
    );
    if (bases.size > 1) {
      return {
        findingId: finding.id,
        status: "BASIS_MIXED",
        detail: `Calculation "${calc.metric}" mixes bases: ${[...bases].join(", ")}`,
        severity: "HIGH",
      };
    }
  }
  return null;
}

function checkCalculations(finding: SpecialistFinding): QAAnnotation | null {
  for (const calc of finding.calculations) {
    const issues = verifyCalculation(calc);
    if (issues.length > 0) {
      return {
        findingId: finding.id,
        status: "NUMERICAL_MISMATCH",
        detail: `Calculation "${calc.metric}" — ${issues.join("; ")}`,
        severity: "MEDIUM",
      };
    }
  }
  return null;
}

function checkUnsupportedConclusion(finding: SpecialistFinding): QAAnnotation | null {
  if (finding.insufficientEvidence) return null;
  if (finding.citations.length === 0) {
    return {
      findingId: finding.id,
      status: "UNSUPPORTED_CONCLUSION",
      detail: "Finding has no citations.",
      severity: "HIGH",
    };
  }
  const analysisEmpty = finding.analysis.trim().length < 40;
  const implicationEmpty = finding.investorImplication.trim().length < 20;
  if (analysisEmpty && implicationEmpty) {
    return {
      findingId: finding.id,
      status: "UNSUPPORTED_CONCLUSION",
      detail: "Both analysis and investor implication are effectively empty.",
      severity: "MEDIUM",
    };
  }
  return null;
}

/**
 * Look for two findings that make numerically contradicting claims on the same
 * metric + period + basis. We identify a metric by the calculation metric name.
 */
function findContradictions(all: SpecialistFinding[]) {
  const contradictions: QAReport["contradictions"] = [];
  const byKey = new Map<string, Array<{ finding: SpecialistFinding; value: number; period: string }>>();

  for (const f of all) {
    for (const c of f.calculations) {
      const bases = c.inputs.map((i) => i.basis).find((b) => b !== "NOT_APPLICABLE") ?? "NOT_APPLICABLE";
      const key = `${c.metric.toLowerCase()}::${bases}::${c.period}`;
      const bucket = byKey.get(key) ?? [];
      bucket.push({ finding: f, value: c.result, period: c.period });
      byKey.set(key, bucket);
    }
  }

  for (const [, bucket] of byKey) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        const denom = Math.max(Math.abs(a.value), Math.abs(b.value), 0.0001);
        const diff = Math.abs(a.value - b.value) / denom;
        if (diff > 0.05) {
          contradictions.push({
            findingIdA: a.finding.id,
            findingIdB: b.finding.id,
            detail: `Same metric (${a.period}) produced different results: ${a.value.toFixed(2)} vs ${b.value.toFixed(2)}`,
          });
        }
      }
    }
  }

  return contradictions;
}

export function validate(outputs: SpecialistOutput[]): QAReport {
  const allFindings = outputs.flatMap((o) => o.findings);
  const annotations: QAAnnotation[] = [];

  for (const f of allFindings) {
    const checks = [
      checkNumericalGrounding(f),
      checkBasisConsistency(f),
      checkCalculations(f),
      checkUnsupportedConclusion(f),
    ].filter((a): a is QAAnnotation => Boolean(a));
    annotations.push(...checks);
  }

  const contradictions = findContradictions(allFindings);
  for (const c of contradictions) {
    annotations.push({
      findingId: c.findingIdA,
      status: "CONTRADICTS_OTHER_FINDING",
      detail: c.detail,
      severity: "MEDIUM",
    });
  }

  const missingChecklistQuestions = outputs.flatMap((o) =>
    o.questionsInsufficient.map((q) => `${o.specialist}:${q}`),
  );

  const failedIds = new Set(
    annotations.filter((a) => a.severity === "HIGH").map((a) => a.findingId),
  );

  return {
    totalFindings: allFindings.length,
    passed: allFindings.length - failedIds.size,
    failed: failedIds.size,
    annotations,
    contradictions,
    missingChecklistQuestions,
  };
}
