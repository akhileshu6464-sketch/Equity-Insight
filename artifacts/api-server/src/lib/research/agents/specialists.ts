/**
 * Seven Specialist Agent Definitions.
 *
 * Each definition maps existing checklist categories → concrete research
 * questions the specialist must attempt. Evidence packs are wired to the
 * existing retrieval system in annual-report-source.ts.
 *
 * These are added on top of the existing framework, not a replacement:
 * every question below corresponds to a category already present in the
 * master research checklist (business, financial, cash, management, RPT,
 * governance, auditor, risks, positives).
 */

import type { SpecialistDefinition } from "./specialist-base.js";

const COMMON_SYSTEM = `You are an equity research specialist. Follow these hard rules:
- Ground every claim in the provided evidence (use exact numbers from the excerpts).
- Never mix consolidated and standalone figures within one calculation.
- Tag every financial fact with its accounting basis and period.
- Do not automatically flag anything as a red flag; assess materiality first.
- Distinguish FACT from INFERENCE from UNCERTAIN.
- Output STRICT JSON matching the schema. No prose outside JSON.`;

// ─────────────────────────────────────────────────────────────
// AGENT 1 — BUSINESS + INDUSTRY
// ─────────────────────────────────────────────────────────────

export const businessIndustry: SpecialistDefinition = {
  key: "business_industry",
  specialty: "business model, industry structure & competitive position",
  systemPrompt: COMMON_SYSTEM,
  evidenceSectionKeys: ["business", "segments", "industry"],
  batchSize: 4,
  questions: [
    { id: "biz_overview", reportSection: "business_overview",
      question: "What does the company actually do — its business model, products/services, and how it makes money?" },
    { id: "biz_revenue_engines", reportSection: "business_overview",
      question: "What are the main revenue engines/segments and their approximate contribution to group revenue and EBITDA?",
      guidance: "Propose calculations for segment share of external turnover and segment EBITDA where numbers permit." },
    { id: "biz_customers_geo", reportSection: "business_overview",
      question: "Who are the customers and what is the geographic mix of the business?" },
    { id: "biz_segment_business_map", reportSection: "segment_analysis",
      question: "Perform detailed analysis of each MATERIAL business segment — what it does, how it earns, and the key change YoY.",
      guidance: "For each material segment, provide segment revenue and EBITDA/segment result if disclosed and compute YoY growth." },
    { id: "biz_competitive_position", reportSection: "competitive_position",
      question: "What is the company's competitive position and moat vs peers within its industry?" },
    { id: "biz_growth_drivers", reportSection: "business_overview",
      question: "What are the identified growth drivers and areas of expansion or investment focus?" },
    { id: "ind_market_structure", reportSection: "industry_context",
      question: "What is the industry / market structure and current environment discussed in the report?" },
    { id: "ind_industry_specific_risks", reportSection: "industry_context",
      question: "What industry-specific dynamics (regulatory, commodity, cyclical) does the company disclose?" },
    { id: "what_changed_business", reportSection: "what_changed",
      question: "What are the most material business-level changes vs the prior year?" },
  ],
};

// ─────────────────────────────────────────────────────────────
// AGENT 2 — FINANCIAL ANALYSIS
// ─────────────────────────────────────────────────────────────

export const financial: SpecialistDefinition = {
  key: "financial",
  specialty: "historical financial performance and ratios",
  systemPrompt: COMMON_SYSTEM,
  evidenceSectionKeys: ["financial", "financial_trends", "ratios", "segments"],
  batchSize: 4,
  questions: [
    { id: "fin_revenue_growth", reportSection: "historical_financials",
      question: "How did consolidated revenue perform this year and over the multi-year trend?",
      guidance: "Propose YoY % and 4-year CAGR if 5 data points are available." },
    { id: "fin_ebitda_margin", reportSection: "historical_financials",
      question: "How did EBITDA and EBITDA margin move?",
      guidance: "Compute margin = EBITDA / Revenue × 100 and margin change vs previous year." },
    { id: "fin_pat_margin", reportSection: "historical_financials",
      question: "How did profit for the year and PAT margin move?",
      guidance: "Compute PAT margin and YoY growth." },
    { id: "fin_eps", reportSection: "historical_financials",
      question: "How did EPS move — basic and diluted where disclosed?",
      guidance: "Compute EPS YoY %." },
    { id: "fin_long_term_trend", reportSection: "historical_financials",
      question: "What does the 10-year (or 5-year) financial highlights table say about long-term direction?",
      guidance: "If the first and last year of a 5+ year window are disclosed, propose CAGR for revenue and profit." },
    { id: "fin_roe_roce", reportSection: "financial_ratios",
      question: "What do the return ratios (ROE / Return on Net Worth / ROCE) show?" },
    { id: "fin_liquidity_ratio", reportSection: "financial_ratios",
      question: "How did liquidity ratios (current ratio) move?" },
    { id: "fin_leverage_ratio", reportSection: "financial_ratios",
      question: "How did leverage / Debt-Equity move?" },
    { id: "fin_segment_econ", reportSection: "historical_financials",
      question: "What do segment results tell us about where profit is being created?",
      guidance: "Propose per-segment result-to-revenue margin if both figures are disclosed on the same basis." },
    { id: "what_changed_financial", reportSection: "what_changed",
      question: "What are the most material financial changes vs the prior year — good and bad?" },
  ],
};

// ─────────────────────────────────────────────────────────────
// AGENT 3 — CASH FLOW + BALANCE SHEET
// ─────────────────────────────────────────────────────────────

export const cashflowBalance: SpecialistDefinition = {
  key: "cashflow_balance",
  specialty: "cash flow, balance sheet, and working capital",
  systemPrompt: COMMON_SYSTEM,
  evidenceSectionKeys: [
    "cash_flow",
    "balance_sheet",
    "receivables",
    "inventory",
    "payables",
    "working_capital",
    "debt",
    "cash_balance_sheet",
  ],
  batchSize: 4,
  questions: [
    { id: "cf_operating", reportSection: "cash_flow_analysis",
      question: "How did operating cash flow move? Compare CFO to reported PAT.",
      guidance: "Propose CFO/PAT ratio if both are on the same accounting basis and period." },
    { id: "cf_capex", reportSection: "cash_flow_analysis",
      question: "What was capex this year and vs the prior year? Any large capital projects called out?" },
    { id: "cf_fcf", reportSection: "cash_flow_analysis",
      question: "What are the free-cash-flow implications (CFO − Capex)?",
      guidance: "Compute FCF only when CFO and Capex are on the SAME accounting basis and period." },
    { id: "cf_conversion", reportSection: "cash_flow_analysis",
      question: "How is cash conversion trending?" },
    { id: "bs_liquidity", reportSection: "balance_sheet_analysis",
      question: "What is the balance-sheet liquidity picture — cash, current assets, current liabilities?" },
    { id: "bs_debt", reportSection: "debt_liquidity",
      question: "What is the debt / net-debt position and how did it change?" },
    { id: "recv_growth_days", reportSection: "receivables_analysis",
      question: "How did trade receivables change vs revenue growth? Are receivable days trending up?",
      guidance: "Propose receivable-days = receivables / revenue × 365 only when SAME basis; also compute receivables YoY % and revenue YoY %." },
    { id: "inv_growth_days", reportSection: "inventory_analysis",
      question: "How did inventory change and what are inventory days doing?",
      guidance: "Propose inventory-days = inventory / (cost of goods or revenue) × 365 only when SAME basis; also compute YoY %." },
    { id: "pay_growth_days", reportSection: "payables_analysis",
      question: "How did trade payables change and what are payable days doing?",
      guidance: "Propose payable-days only when SAME basis; also compute YoY %." },
    { id: "wc_summary", reportSection: "working_capital_analysis",
      question: "What is the overall working capital story — where is cash being tied up or released?" },
    { id: "bs_material_changes", reportSection: "balance_sheet_analysis",
      question: "What are the most material balance-sheet movements this year?" },
  ],
};

// ─────────────────────────────────────────────────────────────
// AGENT 4 — MANAGEMENT + STRATEGY
// ─────────────────────────────────────────────────────────────

export const managementStrategy: SpecialistDefinition = {
  key: "management_strategy",
  specialty: "management commentary, strategy, guidance, and capital allocation",
  systemPrompt: COMMON_SYSTEM +
    " Always separate MANAGEMENT STATEMENT from ANALYST INTERPRETATION.",
  evidenceSectionKeys: ["management", "outlook"],
  batchSize: 4,
  questions: [
    { id: "mgmt_commentary", reportSection: "management_analysis",
      question: "What is management saying about the business this year (their own words)?" },
    { id: "mgmt_priorities", reportSection: "strategy_capital_allocation",
      question: "What are management's stated strategic priorities and business focus areas?" },
    { id: "mgmt_capex_plans", reportSection: "strategy_capital_allocation",
      question: "What capex and expansion plans has management outlined?" },
    { id: "mgmt_new_business", reportSection: "strategy_capital_allocation",
      question: "Any new businesses, launches, acquisitions or divestments discussed?" },
    { id: "mgmt_guidance", reportSection: "guidance_outlook",
      question: "What forward guidance or outlook has management provided?" },
    { id: "mgmt_targets", reportSection: "guidance_outlook",
      question: "Are there any quantitative targets or ambitions stated (revenue, margin, deleveraging, market share)?" },
    { id: "mgmt_guidance_vs_execution", reportSection: "guidance_vs_execution",
      question: "Where the report references past guidance, how did actual execution compare?",
      guidance: "Only answer when the report itself mentions prior year guidance or ambitions — do not fabricate." },
    { id: "mgmt_capital_allocation", reportSection: "strategy_capital_allocation",
      question: "How is management allocating capital — capex vs shareholder returns vs deleveraging?" },
  ],
};

// ─────────────────────────────────────────────────────────────
// AGENT 5 — RPT + GOVERNANCE + SHAREHOLDING
// ─────────────────────────────────────────────────────────────

export const rptGovernance: SpecialistDefinition = {
  key: "rpt_governance",
  specialty: "related-party transactions, governance, and shareholding",
  systemPrompt: COMMON_SYSTEM +
    " An RPT is not automatically a red flag — assess size, pricing, and rationale.",
  evidenceSectionKeys: [
    "related_parties",
    "governance",
    "shareholders",
    "subsidiaries",
  ],
  batchSize: 4,
  questions: [
    { id: "rpt_material_sales", reportSection: "related_party_transactions",
      question: "What material RPT sales/purchases/services are disclosed with subsidiaries / promoter-linked entities?" },
    { id: "rpt_loans_guarantees", reportSection: "related_party_transactions",
      question: "Any loans, advances, or guarantees to related parties disclosed?" },
    { id: "rpt_royalty_fees", reportSection: "related_party_transactions",
      question: "Any royalty, brand fees, or service fees paid to promoter entities?" },
    { id: "rpt_receivables", reportSection: "related_party_transactions",
      question: "Any material receivables from related parties, and how do they compare to trade receivables?" },
    { id: "rpt_rationale", reportSection: "related_party_transactions",
      question: "What commercial rationale is stated for the significant RPTs?" },
    { id: "shr_promoter", reportSection: "shareholding_ownership",
      question: "What is the promoter holding pattern and any change vs prior year?" },
    { id: "shr_pledged", reportSection: "shareholding_ownership",
      question: "Is any promoter holding pledged or encumbered?" },
    { id: "shr_institutional", reportSection: "shareholding_ownership",
      question: "What is the institutional ownership picture (FIIs, DIIs, MFs)?" },
    { id: "gov_board", reportSection: "governance_analysis",
      question: "Board composition and any material governance disclosures?" },
    { id: "gov_contingent", reportSection: "governance_analysis",
      question: "What contingent liabilities and legal/regulatory matters are disclosed?" },
    { id: "sub_material", reportSection: "subsidiaries_jvs",
      question: "Which subsidiaries / JVs are material and what are their key numbers?" },
  ],
};

// ─────────────────────────────────────────────────────────────
// AGENT 6 — AUDITOR + ACCOUNTING
// ─────────────────────────────────────────────────────────────

export const auditorAccounting: SpecialistDefinition = {
  key: "auditor_accounting",
  specialty: "auditor's report and accounting policies",
  systemPrompt: COMMON_SYSTEM +
    " Do NOT merely summarize the auditor's report — for each material item explain WHAT it is, WHY it matters, and INVESTOR IMPLICATION.",
  evidenceSectionKeys: ["governance"],
  batchSize: 4,
  questions: [
    { id: "aud_opinion", reportSection: "auditor_analysis",
      question: "What is the audit opinion, and are there any qualifications?" },
    { id: "aud_emphasis", reportSection: "auditor_analysis",
      question: "Are there any Emphasis of Matter paragraphs? What are they about?" },
    { id: "aud_kam", reportSection: "auditor_analysis",
      question: "What are the Key Audit Matters (KAMs) and what do they signal?" },
    { id: "aud_icfr", reportSection: "auditor_analysis",
      question: "What does the auditor report say about internal financial controls?" },
    { id: "aud_going_concern", reportSection: "auditor_analysis",
      question: "Are there any going-concern remarks or subsequent-events flags?" },
    { id: "acc_judgements", reportSection: "accounting_analysis",
      question: "What are the significant accounting judgements & estimates disclosed?" },
    { id: "acc_policies", reportSection: "accounting_analysis",
      question: "Any material accounting policy changes disclosed?" },
    { id: "acc_auditor_change", reportSection: "accounting_analysis",
      question: "Was there any change of auditor and what was the reason?" },
  ],
};

// ─────────────────────────────────────────────────────────────
// AGENT 7 — RISKS + CATALYSTS + INVESTOR MONITORING
// ─────────────────────────────────────────────────────────────

export const risksCatalysts: SpecialistDefinition = {
  key: "risks_catalysts",
  specialty: "risks, catalysts, and investor monitoring points",
  systemPrompt: COMMON_SYSTEM +
    " Every risk and catalyst must be evidence-backed and material. Do not list generic industry risks that the filing itself does not surface.",
  evidenceSectionKeys: ["risks", "positives", "outlook", "industry"],
  batchSize: 4,
  questions: [
    { id: "risk_business", reportSection: "material_risks",
      question: "What business-level risks are disclosed as material?" },
    { id: "risk_financial", reportSection: "material_risks",
      question: "What financial risks (liquidity, leverage, currency, commodity) are disclosed?" },
    { id: "risk_regulatory", reportSection: "material_risks",
      question: "What regulatory / legal / policy risks are disclosed?" },
    { id: "risk_execution", reportSection: "material_risks",
      question: "What execution risks around growth plans or new businesses are disclosed?" },
    { id: "risk_governance", reportSection: "material_risks",
      question: "Are there any governance-related risk factors surfaced by the filing?" },
    { id: "cat_growth", reportSection: "catalysts_positives",
      question: "What growth catalysts (capacity additions, launches, deleveraging) are evidence-backed?" },
    { id: "cat_industry", reportSection: "catalysts_positives",
      question: "What industry tailwinds are surfaced?" },
    { id: "cat_margin", reportSection: "catalysts_positives",
      question: "Are there any levers for margin improvement or operating leverage discussed?" },
    { id: "monitor_points", reportSection: "investor_monitoring_points",
      question: "What are the top 3-5 things an investor should actively monitor in the next 12 months?" },
    { id: "monitor_thesis_changers", reportSection: "investor_monitoring_points",
      question: "What could materially change the investment thesis — positively or negatively?" },
  ],
};

export const ALL_SPECIALISTS: SpecialistDefinition[] = [
  businessIndustry,
  financial,
  cashflowBalance,
  managementStrategy,
  rptGovernance,
  auditorAccounting,
  risksCatalysts,
];
