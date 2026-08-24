/**
 * Deterministic financial calculator.
 *
 * Every arithmetic operation used in the research report is performed here,
 * NEVER by the LLM. The LLM's job is to extract raw numbers from the annual
 * report; this module verifies and computes derived metrics from those inputs.
 *
 * All results are mathematically reproducible. Same inputs → same outputs.
 */

import type { AccountingBasis } from "../annual-report-types.js";
import type { CalculationRecord } from "./types.js";

export interface NumericInput {
  label: string;
  value: number;
  unit?: string;
  period: string;
  basis: AccountingBasis;
}

function fmtNum(value: number, unit?: string): string {
  if (!Number.isFinite(value)) return "n/a";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "days") return `${value.toFixed(1)} days`;
  if (unit === "x") return `${value.toFixed(2)}x`;
  if (unit === "₹cr") return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;
  if (Math.abs(value) >= 1) return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return value.toFixed(3);
}

/**
 * Guard: never mix bases in a single derived calculation.
 */
function assertSameBasis(inputs: NumericInput[]) {
  const bases = new Set(inputs.map((i) => i.basis));
  bases.delete("NOT_APPLICABLE");
  if (bases.size > 1) {
    throw new Error(
      `Calculation would mix accounting bases: ${[...bases].join(", ")}`,
    );
  }
}

function inputBasis(inputs: NumericInput[]): AccountingBasis {
  for (const i of inputs) if (i.basis !== "NOT_APPLICABLE") return i.basis;
  return "NOT_APPLICABLE";
}

/** YoY %  = (current − previous) / previous × 100 */
export function yoyPercent(
  metricName: string,
  current: NumericInput,
  previous: NumericInput,
): CalculationRecord | null {
  assertSameBasis([current, previous]);
  if (!Number.isFinite(current.value) || !Number.isFinite(previous.value)) return null;
  if (previous.value === 0) return null;
  const result = ((current.value - previous.value) / Math.abs(previous.value)) * 100;
  return {
    metric: `${metricName} YoY %`,
    inputs: [current, previous],
    formula: `(Current − Previous) / |Previous| × 100`,
    result,
    resultLabel: fmtNum(result, "%"),
    period: `${previous.period} → ${current.period}`,
  };
}

/**
 * CAGR = (end / start)^(1/years) − 1
 * Requires start > 0 and years > 0.
 */
export function cagrPercent(
  metricName: string,
  start: NumericInput,
  end: NumericInput,
  years: number,
): CalculationRecord | null {
  assertSameBasis([start, end]);
  if (start.value <= 0 || !Number.isFinite(start.value) || !Number.isFinite(end.value)) return null;
  if (years <= 0) return null;
  const ratio = end.value / start.value;
  if (ratio <= 0) return null;
  const result = (Math.pow(ratio, 1 / years) * 100) - 100;
  return {
    metric: `${metricName} CAGR (${years}-year)`,
    inputs: [start, end],
    formula: `(End / Start)^(1/${years}) − 1`,
    result,
    resultLabel: fmtNum(result, "%"),
    period: `${start.period} → ${end.period}`,
  };
}

/** Margin % = numerator / denominator × 100 (both same basis, same period) */
export function marginPercent(
  metricName: string,
  numerator: NumericInput,
  denominator: NumericInput,
): CalculationRecord | null {
  assertSameBasis([numerator, denominator]);
  if (denominator.value === 0 || !Number.isFinite(denominator.value)) return null;
  const result = (numerator.value / denominator.value) * 100;
  return {
    metric: metricName,
    inputs: [numerator, denominator],
    formula: `${numerator.label} / ${denominator.label} × 100`,
    result,
    resultLabel: fmtNum(result, "%"),
    period: numerator.period,
  };
}

/** Margin change = current margin − previous margin (in percentage points) */
export function marginChange(
  metricName: string,
  current: CalculationRecord,
  previous: CalculationRecord,
): CalculationRecord | null {
  if (!current || !previous) return null;
  const result = current.result - previous.result;
  return {
    metric: `${metricName} change`,
    inputs: [...current.inputs, ...previous.inputs],
    formula: `Current margin − Previous margin`,
    result,
    resultLabel: `${result >= 0 ? "+" : ""}${result.toFixed(1)} pp`,
    period: `${previous.period} → ${current.period}`,
  };
}

/**
 * Days on revenue / cost basis:
 *   Days = balance / flow × period_days
 */
function daysMetric(
  metricName: string,
  balance: NumericInput,
  flow: NumericInput,
  periodDays: number,
): CalculationRecord | null {
  assertSameBasis([balance, flow]);
  if (flow.value === 0 || !Number.isFinite(flow.value)) return null;
  const result = (balance.value / flow.value) * periodDays;
  return {
    metric: metricName,
    inputs: [balance, flow],
    formula: `${balance.label} / ${flow.label} × ${periodDays}`,
    result,
    resultLabel: fmtNum(result, "days"),
    period: balance.period,
  };
}

export const receivableDays = (balance: NumericInput, revenue: NumericInput, periodDays = 365) =>
  daysMetric("Receivable days", balance, revenue, periodDays);

export const inventoryDays = (balance: NumericInput, cogsOrRevenue: NumericInput, periodDays = 365) =>
  daysMetric("Inventory days", balance, cogsOrRevenue, periodDays);

export const payableDays = (balance: NumericInput, purchasesOrCogs: NumericInput, periodDays = 365) =>
  daysMetric("Payable days", balance, purchasesOrCogs, periodDays);

/** Ratio: X / Y  → result formatted as "Xx" */
export function ratio(
  metricName: string,
  numerator: NumericInput,
  denominator: NumericInput,
  unit: "x" | "%" = "x",
): CalculationRecord | null {
  assertSameBasis([numerator, denominator]);
  if (denominator.value === 0 || !Number.isFinite(denominator.value)) return null;
  const result = unit === "%"
    ? (numerator.value / denominator.value) * 100
    : numerator.value / denominator.value;
  return {
    metric: metricName,
    inputs: [numerator, denominator],
    formula: `${numerator.label} / ${denominator.label}${unit === "%" ? " × 100" : ""}`,
    result,
    resultLabel: fmtNum(result, unit),
    period: numerator.period,
  };
}

/** Verify every reported calculation's inputs & basis. Returns list of issues. */
export function verifyCalculation(c: CalculationRecord): string[] {
  const issues: string[] = [];
  const bases = new Set(c.inputs.map((i) => i.basis));
  bases.delete("NOT_APPLICABLE");
  if (bases.size > 1) issues.push(`Mixed accounting bases: ${[...bases].join(", ")}`);
  if (c.inputs.some((i) => !Number.isFinite(i.value))) issues.push("Non-finite input value");
  if (!Number.isFinite(c.result)) issues.push("Non-finite result");
  return issues;
}

export { fmtNum, inputBasis };
