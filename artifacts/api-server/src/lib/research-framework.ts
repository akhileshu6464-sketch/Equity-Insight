/**
 * Research Framework — server-side type definitions and industry logic.
 *
 * This module defines:
 *   - Which analysis sections exist
 *   - Which industry types are recognised
 *   - Which sections and metrics apply to each industry
 *   - How to select a framework for a given company
 *
 * The AI must use the selected framework to decide what to analyse.
 * It must NOT apply irrelevant metrics, and it must NOT invent data.
 */

// ─────────────────────────────────────────────────────────────
// SECTION KEYS  (must match section_key values in the DB seed)
// ─────────────────────────────────────────────────────────────

export const REPORT_SECTIONS = [
  "business",
  "what_happened",
  "financial",
  "cash_flow",
  "balance_sheet",
  "outlook",
  "industry",
  "management",
  "shareholders",
  "governance",
  "related_parties",
  "red_flags",
  "positives",
  "valuation",
  "takeaway",
  // Bank-specific
  "asset_quality",
  // EPC-specific
  "order_book",
  "working_capital",
  // Manufacturing-specific
  "capacity",
  // IT-specific
  "deals",
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

// ─────────────────────────────────────────────────────────────
// INDUSTRY TYPES
// ─────────────────────────────────────────────────────────────

export const INDUSTRY_TYPES = [
  "default",
  "bank",
  "epc",
  "manufacturing",
  "it_services",
  "conglomerate",
] as const;

export type IndustryType = (typeof INDUSTRY_TYPES)[number];

// ─────────────────────────────────────────────────────────────
// SECTION DEFINITION
// ─────────────────────────────────────────────────────────────

export interface SectionDefinition {
  sectionKey: ReportSection;
  sectionLabel: string;
  description: string;
  required: boolean;
}

// ─────────────────────────────────────────────────────────────
// KEY METRIC DEFINITION
// ─────────────────────────────────────────────────────────────

export interface MetricDefinition {
  metricName: string;
  metricLabel: string;
  whyItMatters: string;
  formula?: string;
}

// ─────────────────────────────────────────────────────────────
// CROSS-CHECK RULE DEFINITION
// ─────────────────────────────────────────────────────────────

export interface CrossCheckRule {
  ruleKey: string;
  description: string;
  metricA: string;
  metricB: string;
  expectedRelationship: string;
}

// ─────────────────────────────────────────────────────────────
// RESEARCH CHECK — internal AI investigation rule
// These are NOT displayed to users. They are internal prompts
// the AI uses to decide what to investigate for a given company.
// Context, materiality, duration and evidence determine whether
// a check produces a conclusion — the mere existence of a
// condition is never automatically a red flag.
// ─────────────────────────────────────────────────────────────

export type ResearchCheckCategory =
  | "accounting"
  | "auditor"
  | "consolidated"
  | "capital_allocation"
  | "shareholder_economics"
  | "management"
  | "contingent_liabilities"
  | "long_term";

export interface ResearchCheck {
  /** Unique key — matches check_key in the DB */
  checkKey: string;
  category: ResearchCheckCategory;
  /** What the AI must investigate */
  description: string;
  /**
   * When this check is relevant.
   * The AI must evaluate relevance before applying the check.
   * Not every check applies to every company.
   */
  relevanceNote: string;
  /**
   * Reminder that the existence of a condition is not a conclusion.
   * Always true — included to make the contract explicit.
   */
  notAutomaticRedFlag: true;
  /** What context must be established before a conclusion can be drawn */
  contextRequired: string;
}

// ─────────────────────────────────────────────────────────────
// FINANCIAL BASIS INTEGRITY RULES
// The AI must apply these to every financial calculation.
// Never mix standalone and consolidated figures.
// Never compare peers on different bases without normalising.
// ─────────────────────────────────────────────────────────────

export const FINANCIAL_BASIS_RULES = {
  TRACK_ENTITY:
    "Every financial figure must be tagged with the reporting entity (parent standalone, consolidated group, or named subsidiary).",
  TRACK_BASIS:
    "Every financial figure must be tagged as standalone or consolidated. Never mix the two in a single calculation.",
  TRACK_PERIOD:
    "Every financial figure must be tagged with the exact reporting period (FY24, Q3FY25, LTM, etc.).",
  TRACK_SOURCE:
    "Every financial figure must reference its source document (annual report, quarterly filing, investor presentation, page number where available).",
  PEER_NORMALISATION:
    "For peer comparisons, normalise the reporting basis and period before comparing. If a clean comparison cannot be made on the available data, state that and do not manufacture one.",
  BASIS_BY_QUESTION:
    "The appropriate reporting basis (standalone vs consolidated) must be determined by the analytical question, company structure and industry — not by a blanket rule.",
} as const;

// ─────────────────────────────────────────────────────────────
// INDUSTRY FRAMEWORK
// ─────────────────────────────────────────────────────────────

export interface IndustryFramework {
  industryType: IndustryType;
  displayName: string;
  /**
   * Ordered list of analysis sections the AI must address.
   * Sections marked required:true must always be present.
   * Optional sections should be included only when relevant evidence exists.
   */
  sections: SectionDefinition[];
  /**
   * Metrics the AI must evaluate for this industry.
   * Do not compute or mention metrics not in this list unless
   * the company's profile explicitly warrants it.
   */
  keyMetrics: MetricDefinition[];
  /**
   * Cross-check rules the AI must apply.
   * Each rule compares two related data points to detect contradictions.
   */
  crossCheckRules: CrossCheckRule[];
}

// ─────────────────────────────────────────────────────────────
// FRAMEWORK REGISTRY
// Mirrors the industry_frameworks table in Supabase.
// Source of truth for runtime framework selection.
// ─────────────────────────────────────────────────────────────

export const INDUSTRY_FRAMEWORKS: Record<IndustryType, IndustryFramework> = {

  default: {
    industryType: "default",
    displayName: "General (all companies)",
    sections: [
      { sectionKey: "business",       sectionLabel: "Business",               description: "What the company does, how it makes money, and what drives its economics",  required: true },
      { sectionKey: "what_happened",  sectionLabel: "What is happening",      description: "Recent developments in the business, not just price movements",            required: true },
      { sectionKey: "financial",      sectionLabel: "Financial picture",      description: "Revenue, profit, and margin trends with evidence",                          required: true },
      { sectionKey: "cash_flow",      sectionLabel: "Cash flow",              description: "Operating cash vs profit, and what is absorbing or generating cash",        required: true },
      { sectionKey: "balance_sheet",  sectionLabel: "Balance sheet",          description: "Debt, equity, liquidity and asset quality",                                 required: true },
      { sectionKey: "outlook",        sectionLabel: "Business outlook",       description: "Where the company and its markets appear to be headed",                     required: true },
      { sectionKey: "industry",       sectionLabel: "Industry",               description: "Competitive dynamics, demand trends, regulation",                           required: true },
      { sectionKey: "management",     sectionLabel: "Management",             description: "Did management deliver on prior guidance? What are they saying now?",       required: true },
      { sectionKey: "shareholders",   sectionLabel: "Shareholders",           description: "Promoter/major shareholder changes and what they might signal",             required: true },
      { sectionKey: "governance",     sectionLabel: "Governance",             description: "Board quality, auditor changes, disclosure standards",                      required: false },
      { sectionKey: "related_parties",sectionLabel: "Related-party transactions", description: "Are related-party transactions material or unusual?",                  required: false },
      { sectionKey: "red_flags",      sectionLabel: "Red flags",              description: "Contradictions, unusual patterns, or accounting concerns — with evidence",  required: true },
      { sectionKey: "positives",      sectionLabel: "Positive developments",  description: "Genuine strengths or improvements, not marketing",                         required: true },
      { sectionKey: "valuation",      sectionLabel: "Valuation",              description: "How the market is pricing the company relative to its financials",          required: false },
      { sectionKey: "takeaway",       sectionLabel: "Investor takeaway",      description: "The single most important thing an investor should understand",             required: true },
    ],
    keyMetrics: [
      { metricName: "revenue_growth",    metricLabel: "Revenue growth",         whyItMatters: "Is the top line actually expanding?" },
      { metricName: "ebitda_margin",     metricLabel: "EBITDA margin",          whyItMatters: "Are revenues translating into operating profit?" },
      { metricName: "pat_margin",        metricLabel: "PAT margin",             whyItMatters: "What remains for shareholders after all costs?" },
      { metricName: "operating_cash",    metricLabel: "Operating cash flow",    whyItMatters: "Cash is harder to manipulate than profit" },
      { metricName: "fcf",               metricLabel: "Free cash flow",         whyItMatters: "Cash left after sustaining the business" },
      { metricName: "debt_equity",       metricLabel: "Debt/Equity",            whyItMatters: "How leveraged is the balance sheet?" },
      { metricName: "interest_coverage", metricLabel: "Interest coverage",      whyItMatters: "Can the company comfortably service its debt?" },
      { metricName: "roce",              metricLabel: "ROCE",                   whyItMatters: "Is capital being deployed productively?" },
    ],
    crossCheckRules: [
      { ruleKey: "pl_vs_cashflow",         description: "P&L profit vs operating cash flow",        metricA: "pat",              metricB: "operating_cash",      expectedRelationship: "operating_cash should exceed pat for a healthy business" },
      { ruleKey: "revenue_vs_receivables", description: "Revenue growth vs receivables growth",     metricA: "revenue_growth",   metricB: "receivables_growth",  expectedRelationship: "receivables should not consistently outpace revenue" },
      { ruleKey: "profit_vs_cashflow",     description: "Reported profit vs operating cash",        metricA: "ebitda",           metricB: "operating_cash",      expectedRelationship: "large persistent divergence warrants investigation" },
      { ruleKey: "debt_vs_interest",       description: "Total debt vs interest expense",           metricA: "debt",             metricB: "interest_expense",    expectedRelationship: "implied rate should be plausible given market rates" },
      { ruleKey: "capex_vs_depreciation",  description: "Capex vs depreciation",                   metricA: "capex",            metricB: "depreciation",        expectedRelationship: "high capex/depreciation signals heavy investment phase" },
      { ruleKey: "mgmt_guidance_vs_result",description: "Prior management guidance vs actual",     metricA: "guided_metric",    metricB: "actual_metric",       expectedRelationship: "consistent misses erode credibility" },
      // ── New cross-check rules added in migration 002 ──────────────────────────────
      { ruleKey: "eps_vs_pat_growth",      description: "EPS growth vs PAT growth — detects share-count dilution",    metricA: "eps_growth",       metricB: "pat_growth",          expectedRelationship: "EPS growing materially slower than PAT indicates dilution from QIPs, warrants, ESOPs or preferential allotments; investigate cause and shareholder impact" },
      { ruleKey: "other_income_vs_pat",    description: "Other income as proportion of reported PAT",                 metricA: "other_income",     metricB: "pat",                 expectedRelationship: "other income consistently exceeding 20-25% of PAT shifts profit source away from core operations; assess sustainability and recurrence" },
      { ruleKey: "exceptional_vs_pat",     description: "Exceptional and non-recurring items relative to PAT",        metricA: "exceptional_items",metricB: "pat",                 expectedRelationship: "significant exceptional items require computing adjusted PAT; a one-time gain must not be treated as recurring" },
    ],
  },

  bank: {
    industryType: "bank",
    displayName: "Bank / NBFC",
    sections: [
      { sectionKey: "business",       sectionLabel: "Business",               description: "Lending model, deposit franchise, and target customer segments",           required: true },
      { sectionKey: "what_happened",  sectionLabel: "What is happening",      description: "Credit growth, deposit trends, asset quality changes",                    required: true },
      { sectionKey: "financial",      sectionLabel: "Financial picture",      description: "NII, NIM, fee income, provisions, PAT",                                   required: true },
      { sectionKey: "asset_quality",  sectionLabel: "Asset quality",          description: "GNPA, NNPA, slippage, provision coverage, stressed book",                 required: true },
      { sectionKey: "balance_sheet",  sectionLabel: "Balance sheet",          description: "CASA ratio, CD ratio, capital adequacy (CAR/CET1)",                       required: true },
      { sectionKey: "outlook",        sectionLabel: "Business outlook",       description: "Credit cycle, deposit competition, growth runway",                        required: true },
      { sectionKey: "industry",       sectionLabel: "Industry",               description: "Credit growth environment, RBI policy, competitive pressure",             required: true },
      { sectionKey: "management",     sectionLabel: "Management",             description: "Guidance on credit growth, NIM, and asset quality",                      required: true },
      { sectionKey: "shareholders",   sectionLabel: "Shareholders",           description: "Promoter, FII, and DII holding changes",                                  required: true },
      { sectionKey: "governance",     sectionLabel: "Governance",             description: "RBI audit findings, auditor notes, board independence",                  required: true },
      { sectionKey: "related_parties",sectionLabel: "Related-party transactions", description: "Loans to related parties, inter-group transactions",                required: true },
      { sectionKey: "red_flags",      sectionLabel: "Red flags",              description: "Divergence between reported NPA and slippage, diverging book quality",   required: true },
      { sectionKey: "positives",      sectionLabel: "Positive developments",  description: "CASA improvement, NPA recovery, fee income diversification",             required: true },
      { sectionKey: "valuation",      sectionLabel: "Valuation",              description: "P/B, P/E vs ROE vs peers",                                               required: true },
      { sectionKey: "takeaway",       sectionLabel: "Investor takeaway",      description: "Net assessment for the banking investor",                                 required: true },
    ],
    keyMetrics: [
      { metricName: "nim",                metricLabel: "Net Interest Margin (NIM)",      whyItMatters: "Core profitability of the lending book" },
      { metricName: "gnpa",               metricLabel: "Gross NPA ratio",               whyItMatters: "Proportion of bad loans in the book" },
      { metricName: "nnpa",               metricLabel: "Net NPA ratio",                 whyItMatters: "Bad loans net of provisions" },
      { metricName: "provision_coverage", metricLabel: "Provision coverage ratio",      whyItMatters: "How well bad loans are covered" },
      { metricName: "casa_ratio",         metricLabel: "CASA ratio",                    whyItMatters: "Low-cost deposit base; higher is better for funding cost" },
      { metricName: "credit_growth",      metricLabel: "Credit growth (YoY)",           whyItMatters: "Is the loan book growing and at what pace?" },
      { metricName: "cd_ratio",           metricLabel: "Credit/Deposit ratio",          whyItMatters: "Liquidity and funding efficiency" },
      { metricName: "car",                metricLabel: "Capital Adequacy Ratio (CAR)",  whyItMatters: "Regulatory buffer and growth capacity" },
      { metricName: "roa",                metricLabel: "Return on Assets (ROA)",        whyItMatters: "Efficiency of asset utilisation" },
      { metricName: "roe",                metricLabel: "Return on Equity (ROE)",        whyItMatters: "Returns to equity shareholders" },
      { metricName: "slippage_ratio",     metricLabel: "Slippage ratio",               whyItMatters: "Rate at which standard loans become non-performing" },
      { metricName: "pb_ratio",           metricLabel: "Price to Book (P/B)",          whyItMatters: "Market premium to book; compare to ROE" },
    ],
    crossCheckRules: [
      { ruleKey: "npa_vs_provisions",        description: "NPA trend vs provisioning",            metricA: "gnpa",           metricB: "provision_coverage",  expectedRelationship: "rising NPA with falling coverage is a warning sign" },
      { ruleKey: "nim_vs_credit_cost",       description: "NIM vs credit cost",                   metricA: "nim",            metricB: "credit_cost",         expectedRelationship: "credit cost eroding NIM narrows the profitability gap" },
      { ruleKey: "slippage_vs_mgmt_guidance",description: "Slippage rate vs management guidance", metricA: "slippage_ratio", metricB: "guided_slippage",     expectedRelationship: "consistent misses signal inadequate risk controls" },
      { ruleKey: "cd_ratio_trend",           description: "Credit/deposit ratio trend",            metricA: "credit_growth",  metricB: "deposit_growth",      expectedRelationship: "credit outpacing deposits significantly tightens liquidity" },
    ],
  },

  epc: {
    industryType: "epc",
    displayName: "EPC / Infrastructure",
    sections: [
      { sectionKey: "business",       sectionLabel: "Business",               description: "Project types, geographies, client mix, and competitive positioning",    required: true },
      { sectionKey: "what_happened",  sectionLabel: "What is happening",      description: "Order inflows, execution pace, milestone billings",                      required: true },
      { sectionKey: "financial",      sectionLabel: "Financial picture",      description: "Revenue, EBITDA margin, and PAT — and which projects drove them",        required: true },
      { sectionKey: "order_book",     sectionLabel: "Order book",             description: "Order book size, mix, book-to-bill, and quality of orders",              required: true },
      { sectionKey: "working_capital",sectionLabel: "Working capital",        description: "Receivables, unbilled revenue, payables — EPC is working-capital-intensive", required: true },
      { sectionKey: "cash_flow",      sectionLabel: "Cash flow",              description: "Operating cash vs reported profit — divergence is a red flag in EPC",   required: true },
      { sectionKey: "balance_sheet",  sectionLabel: "Balance sheet",          description: "Debt levels, ROCE, and whether the capital structure supports the pipeline", required: true },
      { sectionKey: "outlook",        sectionLabel: "Business outlook",       description: "Bidding pipeline, sector spending trends, government capex",             required: true },
      { sectionKey: "industry",       sectionLabel: "Industry",               description: "Government spending, commodity costs, competition intensity",            required: true },
      { sectionKey: "management",     sectionLabel: "Management",             description: "Execution track record — does margin guidance match delivery?",          required: true },
      { sectionKey: "shareholders",   sectionLabel: "Shareholders",           description: "Promoter holding and pledge levels",                                      required: true },
      { sectionKey: "governance",     sectionLabel: "Governance",             description: "Auditor qualifications, contingent liabilities, claims/disputes",       required: true },
      { sectionKey: "related_parties",sectionLabel: "Related-party transactions", description: "Subcontracting and transactions with promoter-linked entities",     required: true },
      { sectionKey: "red_flags",      sectionLabel: "Red flags",              description: "Rising receivables, low cash conversion, promoter pledge",              required: true },
      { sectionKey: "positives",      sectionLabel: "Positive developments",  description: "Strong order inflows, improving execution, margin expansion",           required: true },
      { sectionKey: "valuation",      sectionLabel: "Valuation",              description: "P/E, EV/EBITDA vs order book and execution track record",               required: false },
      { sectionKey: "takeaway",       sectionLabel: "Investor takeaway",      description: "Net assessment for the EPC investor",                                    required: true },
    ],
    keyMetrics: [
      { metricName: "order_book",          metricLabel: "Order book (₹ cr)",          whyItMatters: "Visibility into future revenue" },
      { metricName: "book_to_bill",        metricLabel: "Book-to-bill ratio",          whyItMatters: "Order book as multiple of annual revenue; visibility buffer" },
      { metricName: "order_inflow",        metricLabel: "Order inflow (YoY)",          whyItMatters: "Is the pipeline being replenished?" },
      { metricName: "ebitda_margin",       metricLabel: "EBITDA margin",               whyItMatters: "Are project economics improving or deteriorating?" },
      { metricName: "roce",                metricLabel: "ROCE",                        whyItMatters: "Capital efficiency in a capital-intensive business" },
      { metricName: "debtor_days",         metricLabel: "Debtor days",                 whyItMatters: "Rising debtor days signal collection risk or aggressive revenue recognition" },
      { metricName: "unbilled_revenue",    metricLabel: "Unbilled revenue (₹ cr)",    whyItMatters: "Large unbilled balances can inflate revenue before cash is collected" },
      { metricName: "cash_conversion",     metricLabel: "Cash conversion ratio",       whyItMatters: "Operating cash / EBITDA — <0.5 is a warning in EPC" },
      { metricName: "net_debt",            metricLabel: "Net debt (₹ cr)",            whyItMatters: "Leverage relative to EBITDA" },
      { metricName: "promoter_pledge",     metricLabel: "Promoter pledge %",           whyItMatters: "High pledge signals financial stress at promoter level" },
    ],
    crossCheckRules: [
      { ruleKey: "revenue_vs_receivables", description: "Revenue growth vs receivables/unbilled growth", metricA: "revenue_growth", metricB: "receivables_growth", expectedRelationship: "receivables consistently outpacing revenue is a red flag" },
      { ruleKey: "profit_vs_cashflow",     description: "Reported profit vs operating cash flow",        metricA: "pat",            metricB: "operating_cash",     expectedRelationship: "persistent divergence signals aggressive recognition or collection issues" },
      { ruleKey: "order_book_vs_revenue",  description: "Order book trend vs revenue delivery",          metricA: "order_book",     metricB: "revenue",            expectedRelationship: "stagnant book-to-bill despite claimed pipeline is a warning" },
      { ruleKey: "mgmt_margin_guidance",   description: "Management margin guidance vs delivered",       metricA: "guided_margin",  metricB: "actual_margin",      expectedRelationship: "consistent misses reduce credibility of forward guidance" },
    ],
  },

  manufacturing: {
    industryType: "manufacturing",
    displayName: "Manufacturing",
    sections: [
      { sectionKey: "business",       sectionLabel: "Business",               description: "Products, end-markets, customer concentration, and competitive moat",   required: true },
      { sectionKey: "what_happened",  sectionLabel: "What is happening",      description: "Volume, realisation, and capacity changes",                             required: true },
      { sectionKey: "financial",      sectionLabel: "Financial picture",      description: "Revenue, margins, and what drove the change",                           required: true },
      { sectionKey: "capacity",       sectionLabel: "Capacity & utilisation", description: "Current capacity, utilisation, and planned expansion",                  required: true },
      { sectionKey: "working_capital",sectionLabel: "Working capital",        description: "Inventory, receivables, payables, and cash conversion cycle",           required: true },
      { sectionKey: "cash_flow",      sectionLabel: "Cash flow",              description: "Operating cash, capex cycle, and free cash generation",                 required: true },
      { sectionKey: "balance_sheet",  sectionLabel: "Balance sheet",          description: "Asset turnover, debt and leverage relative to EBITDA",                  required: true },
      { sectionKey: "outlook",        sectionLabel: "Business outlook",       description: "Demand environment, pricing power, and expansion plans",                required: true },
      { sectionKey: "industry",       sectionLabel: "Industry",               description: "Demand cycles, commodity input costs, import competition",              required: true },
      { sectionKey: "management",     sectionLabel: "Management",             description: "Capex commitments, volume guidance, and delivery track record",         required: true },
      { sectionKey: "shareholders",   sectionLabel: "Shareholders",           description: "Promoter holding, institutional interest",                              required: true },
      { sectionKey: "governance",     sectionLabel: "Governance",             description: "Auditor notes, contingent liabilities, related-party sales",           required: false },
      { sectionKey: "related_parties",sectionLabel: "Related-party transactions", description: "Sales to or purchases from promoter-linked entities",             required: false },
      { sectionKey: "red_flags",      sectionLabel: "Red flags",              description: "Inventory build, margin deterioration, cash conversion decline",       required: true },
      { sectionKey: "positives",      sectionLabel: "Positive developments",  description: "Market share gains, new products, margin expansion",                   required: true },
      { sectionKey: "valuation",      sectionLabel: "Valuation",              description: "EV/EBITDA, P/E vs cycle position and ROE",                             required: false },
      { sectionKey: "takeaway",       sectionLabel: "Investor takeaway",      description: "Net assessment for the manufacturing investor",                         required: true },
    ],
    keyMetrics: [
      { metricName: "capacity_utilisation", metricLabel: "Capacity utilisation %",    whyItMatters: "Operating leverage — utilisation above 80% is where margins improve" },
      { metricName: "volume_growth",        metricLabel: "Volume growth (YoY)",       whyItMatters: "Distinguishes real demand growth from price-driven revenue" },
      { metricName: "realisation_per_unit", metricLabel: "Realisation per unit",      whyItMatters: "Pricing power or commodity passthrough" },
      { metricName: "gross_margin",         metricLabel: "Gross margin",              whyItMatters: "Impact of input costs before fixed-cost absorption" },
      { metricName: "ebitda_margin",        metricLabel: "EBITDA margin",             whyItMatters: "Operating profitability after variable and fixed costs" },
      { metricName: "asset_turnover",       metricLabel: "Asset turnover",            whyItMatters: "Revenue generated per rupee of assets" },
      { metricName: "roce",                 metricLabel: "ROCE",                      whyItMatters: "Core profitability measure for capital-intensive businesses" },
      { metricName: "inventory_days",       metricLabel: "Inventory days",            whyItMatters: "Rising inventory relative to sales can signal demand slowdown" },
      { metricName: "capex_to_sales",       metricLabel: "Capex to sales ratio",      whyItMatters: "Investment intensity; compare to capacity additions" },
      { metricName: "fcf_yield",            metricLabel: "Free cash flow yield",      whyItMatters: "Cash actually generated for shareholders" },
    ],
    crossCheckRules: [
      { ruleKey: "volume_vs_revenue",     description: "Volume growth vs revenue growth",             metricA: "volume_growth",    metricB: "revenue_growth",   expectedRelationship: "large divergence implies price movement, not demand" },
      { ruleKey: "inventory_vs_sales",    description: "Inventory build vs sales growth",             metricA: "inventory_growth", metricB: "revenue_growth",   expectedRelationship: "inventory growing much faster than sales suggests demand slowdown" },
      { ruleKey: "capex_vs_utilisation",  description: "Capex programme vs current utilisation",      metricA: "capex",            metricB: "utilisation_pct",  expectedRelationship: "large capex at <70% utilisation needs a clear demand rationale" },
      { ruleKey: "margin_vs_input_cost",  description: "EBITDA margin vs raw material cost trend",    metricA: "ebitda_margin",    metricB: "rm_cost_pct",      expectedRelationship: "margin improvement despite rising RM costs implies pricing power" },
    ],
  },

  it_services: {
    industryType: "it_services",
    displayName: "IT Services / Technology",
    sections: [
      { sectionKey: "business",       sectionLabel: "Business",               description: "Service lines, verticals, client concentration, and delivery model",    required: true },
      { sectionKey: "what_happened",  sectionLabel: "What is happening",      description: "Revenue growth, deal wins, and discretionary spending environment",    required: true },
      { sectionKey: "financial",      sectionLabel: "Financial picture",      description: "Revenue, EBIT margin, headcount, and USD revenue growth",              required: true },
      { sectionKey: "deals",          sectionLabel: "Deal pipeline & wins",   description: "Large deal TCV, deal type (new vs renewal), and ramp timelines",       required: true },
      { sectionKey: "cash_flow",      sectionLabel: "Cash flow",              description: "IT typically generates strong cash; watch DSO and buyback capacity",  required: true },
      { sectionKey: "balance_sheet",  sectionLabel: "Balance sheet",          description: "Cash-heavy; assess capital return policy",                             required: true },
      { sectionKey: "outlook",        sectionLabel: "Business outlook",       description: "Client spending environment, AI impact, and vertical mix",             required: true },
      { sectionKey: "industry",       sectionLabel: "Industry",               description: "Global IT spend, offshoring trends, AI disruption risk",              required: true },
      { sectionKey: "management",     sectionLabel: "Management",             description: "Growth guidance range, margin levers cited, and delivery",             required: true },
      { sectionKey: "shareholders",   sectionLabel: "Shareholders",           description: "Promoter holding, FII flows, buyback history",                         required: true },
      { sectionKey: "governance",     sectionLabel: "Governance",             description: "Client concentration risk, key-person risk, auditor notes",           required: false },
      { sectionKey: "related_parties",sectionLabel: "Related-party transactions", description: "Promoter-entity transactions, subsidiary loans",                 required: false },
      { sectionKey: "red_flags",      sectionLabel: "Red flags",              description: "Revenue recognition issues, attrition spikes, deal misses",           required: true },
      { sectionKey: "positives",      sectionLabel: "Positive developments",  description: "Large deal momentum, margin expansion, AI-led revenue growth",        required: true },
      { sectionKey: "valuation",      sectionLabel: "Valuation",              description: "P/E vs growth vs peers; FCF yield",                                    required: false },
      { sectionKey: "takeaway",       sectionLabel: "Investor takeaway",      description: "Net assessment for the IT services investor",                          required: true },
    ],
    keyMetrics: [
      { metricName: "revenue_growth_cc",    metricLabel: "Revenue growth (constant currency)",   whyItMatters: "Removes FX noise from the growth picture" },
      { metricName: "ebit_margin",          metricLabel: "EBIT margin",                          whyItMatters: "Operating profitability after people costs" },
      { metricName: "utilisation",          metricLabel: "Utilisation rate %",                   whyItMatters: "Efficiency of the delivery workforce" },
      { metricName: "attrition",            metricLabel: "Attrition rate (LTM)",                 whyItMatters: "High attrition increases cost and delivery risk" },
      { metricName: "large_deal_tcv",       metricLabel: "Large deal TCV",                       whyItMatters: "Forward revenue visibility; new vs renewal mix matters" },
      { metricName: "headcount_growth",     metricLabel: "Net headcount growth",                 whyItMatters: "Inverse indicator of demand when headcount is being cut" },
      { metricName: "dso",                  metricLabel: "Days Sales Outstanding (DSO)",         whyItMatters: "Rising DSO can signal collection difficulty or aggressive recognition" },
      { metricName: "fcf_conversion",       metricLabel: "FCF conversion (FCF/PAT)",             whyItMatters: "IT should convert >90% of profit to cash — deviation is a flag" },
      { metricName: "revenue_per_employee", metricLabel: "Revenue per employee",                 whyItMatters: "Productivity trend; improvement required with AI headwinds" },
    ],
    crossCheckRules: [
      { ruleKey: "revenue_vs_headcount",  description: "Revenue growth vs headcount growth",          metricA: "revenue_growth", metricB: "headcount_growth", expectedRelationship: "flat headcount with revenue growth is positive; reverse is a warning" },
      { ruleKey: "dso_vs_revenue",        description: "DSO trend vs revenue recognition",            metricA: "dso",            metricB: "revenue_growth",   expectedRelationship: "rising DSO alongside revenue growth may signal aggressive recognition" },
      { ruleKey: "deal_wins_vs_revenue",  description: "Deal TCV vs revenue ramp",                   metricA: "deal_tcv",       metricB: "revenue_growth",   expectedRelationship: "strong TCV not converting to revenue after 2-4 quarters needs explanation" },
      { ruleKey: "mgmt_margin_guidance",  description: "Management margin guidance vs delivered",    metricA: "guided_margin",  metricB: "actual_margin",    expectedRelationship: "consistent misses or beats indicate guidance quality" },
    ],
  },

  conglomerate: {
    industryType: "conglomerate",
    displayName: "Conglomerate / Diversified",
    sections: [
      { sectionKey: "business",       sectionLabel: "Business",               description: "Each major segment, how they interact, and the group's strategic logic", required: true },
      { sectionKey: "what_happened",  sectionLabel: "What is happening",      description: "Segment-level performance; which parts drove the consolidated result",  required: true },
      { sectionKey: "financial",      sectionLabel: "Financial picture",      description: "Consolidated and segment revenue, EBITDA, and PAT",                     required: true },
      { sectionKey: "cash_flow",      sectionLabel: "Cash flow",              description: "Operating cash vs profit; capex allocation across segments",            required: true },
      { sectionKey: "balance_sheet",  sectionLabel: "Balance sheet",          description: "Consolidated debt, segment-level leverage, and capital allocation",     required: true },
      { sectionKey: "outlook",        sectionLabel: "Business outlook",       description: "Each major segment's outlook and the group's investment priorities",    required: true },
      { sectionKey: "industry",       sectionLabel: "Industry",               description: "Key industry trends affecting each segment",                             required: true },
      { sectionKey: "management",     sectionLabel: "Management",             description: "Group strategy, segment guidance, and delivery track record",           required: true },
      { sectionKey: "shareholders",   sectionLabel: "Shareholders",           description: "Promoter holding, institutional flows",                                  required: true },
      { sectionKey: "governance",     sectionLabel: "Governance",             description: "Group structure complexity, inter-company transactions, auditor notes", required: true },
      { sectionKey: "related_parties",sectionLabel: "Related-party transactions", description: "Inter-segment and promoter-linked transactions at scale",          required: true },
      { sectionKey: "red_flags",      sectionLabel: "Red flags",              description: "Segment cross-subsidies, rising group debt, opaque structure",         required: true },
      { sectionKey: "positives",      sectionLabel: "Positive developments",  description: "Segment re-rating, strong consumer growth, new business scale-up",     required: true },
      { sectionKey: "valuation",      sectionLabel: "Valuation",              description: "Sum-of-parts vs consolidated market cap; segment multiples",           required: true },
      { sectionKey: "takeaway",       sectionLabel: "Investor takeaway",      description: "Net assessment across all segments",                                    required: true },
    ],
    keyMetrics: [
      { metricName: "segment_ebitda_mix",      metricLabel: "Segment EBITDA mix",            whyItMatters: "Which businesses actually drive profitability?" },
      { metricName: "consolidated_roce",       metricLabel: "Consolidated ROCE",              whyItMatters: "Is the sum of all capital deployment productive?" },
      { metricName: "net_debt",                metricLabel: "Net debt (₹ cr)",               whyItMatters: "Conglomerates can hide debt in subsidiaries" },
      { metricName: "fcf",                     metricLabel: "Free cash flow",                 whyItMatters: "After heavy capex across segments, is real cash generated?" },
      { metricName: "capex_allocation",        metricLabel: "Capex by segment",               whyItMatters: "Where is management placing its bets?" },
      { metricName: "sop_discount",            metricLabel: "SOP discount to market cap",     whyItMatters: "How much is the market discounting the conglomerate structure?" },
      { metricName: "revenue_growth_consumer", metricLabel: "Consumer segment revenue growth",whyItMatters: "Recurring consumer businesses reduce cyclicality dependence" },
    ],
    crossCheckRules: [
      { ruleKey: "segment_cash_vs_group_debt", description: "Segment cash generation vs group debt repayment", metricA: "operating_cash", metricB: "net_debt_change",    expectedRelationship: "rising group debt while segments generate cash needs explanation" },
      { ruleKey: "capex_vs_returns",           description: "Capex vs eventual returns by segment",            metricA: "capex",          metricB: "roce_by_segment",    expectedRelationship: "sustained low ROCE segments absorbing disproportionate capex is a flag" },
      { ruleKey: "related_party_scale",        description: "Related-party transactions vs group revenue",      metricA: "rpt_value",      metricB: "revenue",            expectedRelationship: "RPT growing faster than revenue in a conglomerate requires scrutiny" },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// FRAMEWORK SELECTION
// ─────────────────────────────────────────────────────────────

/**
 * Returns the most appropriate IndustryFramework for a company.
 *
 * Priority order:
 * 1. Exact match on industryType
 * 2. Keyword match against industry / sector strings
 * 3. Falls back to 'default'
 *
 * The AI must refine this selection if the company's business
 * description contradicts the initial classification.
 */
export function selectFramework(params: {
  industry: string;
  sector: string;
  subIndustry?: string | null;
}): IndustryFramework {
  const haystack = [params.industry, params.sector, params.subIndustry ?? ""]
    .join(" ")
    .toLowerCase();

  if (/bank|nbfc|finance|lending|microfinance|housing finance/.test(haystack)) {
    return INDUSTRY_FRAMEWORKS.bank;
  }
  if (/epc|infrastructure|construction|project|power transmission|roads|irrigation/.test(haystack)) {
    return INDUSTRY_FRAMEWORKS.epc;
  }
  if (/manufactur|steel|cement|chemical|pharma|auto|textile|paper|glass|plastic/.test(haystack)) {
    return INDUSTRY_FRAMEWORKS.manufacturing;
  }
  if (/information technology|it service|software|bpo|technology service/.test(haystack)) {
    return INDUSTRY_FRAMEWORKS.it_services;
  }
  if (/conglomerate|diversified|holding/.test(haystack)) {
    return INDUSTRY_FRAMEWORKS.conglomerate;
  }

  return INDUSTRY_FRAMEWORKS.default;
}

/**
 * Returns the required sections for a given framework.
 * Use this to tell the AI which sections it must always produce.
 */
export function getRequiredSections(framework: IndustryFramework): SectionDefinition[] {
  return framework.sections.filter((s) => s.required);
}

// ─────────────────────────────────────────────────────────────
// UNIVERSAL RESEARCH CHECKS
// Internal AI investigation rules that apply to every company
// regardless of industry.  The AI must decide which are relevant
// before applying them.  These must never appear as questions
// in the user-facing report.
// ─────────────────────────────────────────────────────────────

export const UNIVERSAL_RESEARCH_CHECKS: ResearchCheck[] = [

  // ── ACCOUNTING ──────────────────────────────────────────────
  {
    checkKey: "accounting_policy_changes",
    category: "accounting",
    description: "Investigate whether the company changed accounting policies or material accounting estimates (depreciation, useful lives, revenue recognition, inventory valuation) and whether those changes materially affected reported earnings.",
    relevanceNote: "Apply when the notes to accounts or auditor report flag a change, or when margins shift sharply without an obvious operational explanation.",
    notAutomaticRedFlag: true,
    contextRequired: "Determine whether the change was driven by a genuine shift in business reality, regulatory alignment (Ind AS transition, SEBI mandate) or earnings management. Quantify the impact before concluding.",
  },
  {
    checkKey: "exceptional_items_quality",
    category: "accounting",
    description: "Quantify exceptional and non-recurring items (asset disposals, impairments, litigation settlements, restructuring charges, forex gains/losses on debt). Compute adjusted PAT excluding these items and assess the underlying operating trend.",
    relevanceNote: "Always apply. Recurring reliance on exceptional gains to report profit growth is a concern; a one-time write-down of a genuinely impaired asset is not.",
    notAutomaticRedFlag: true,
    contextRequired: "Assess whether the item is truly non-recurring, whether it recurs in multiple periods, and whether management is transparent about it.",
  },
  {
    checkKey: "other_income_quality",
    category: "accounting",
    description: "Assess how much of reported profit comes from other income (interest on surplus cash, dividends from subsidiaries, profit on asset sales, rental income, forex translation gains) rather than the core operating business.",
    relevanceNote: "Apply when other income is a material proportion of reported PAT. Especially important for holding companies, cash-rich businesses and conglomerates.",
    notAutomaticRedFlag: true,
    contextRequired: "Distinguish structural other income (e.g., interest on a genuinely cash-rich treasury) from non-recurring items misclassified as other income. Assess recurrence and cash realisation.",
  },

  // ── AUDITOR ──────────────────────────────────────────────────
  {
    checkKey: "auditor_change",
    category: "auditor",
    description: "Investigate whether the statutory auditor changed or resigned. Establish the stated reason, the timing relative to financial results, and whether the incoming auditor is of similar standing.",
    relevanceNote: "Apply whenever an auditor change is noted. A change following a management dispute, qualification or regulatory inquiry carries more weight than routine rotation.",
    notAutomaticRedFlag: true,
    contextRequired: "Distinguish mandatory rotation (regulatory requirement) from voluntary change or resignation. A resignation mid-year or shortly before results is more significant than a scheduled change.",
  },
  {
    checkKey: "restatements",
    category: "auditor",
    description: "Identify whether prior-period financial statements were restated, the magnitude of the restatement, and the stated reason. Assess whether the restatement affects the investment thesis materially.",
    relevanceNote: "Apply whenever current-year accounts include restated prior-year comparatives that differ from previously published figures.",
    notAutomaticRedFlag: true,
    contextRequired: "Determine whether the restatement relates to an error, a regulatory correction, or a genuine reassessment. Magnitude and pattern (repeated restatements) determine severity.",
  },
  {
    checkKey: "internal_control_weaknesses",
    category: "auditor",
    description: "Identify material weaknesses in internal financial controls reported by the auditor or management, and assess whether they have been remediated in subsequent periods.",
    relevanceNote: "Apply when the auditor report contains qualifications, emphasis of matter paragraphs, or an adverse opinion on internal controls.",
    notAutomaticRedFlag: true,
    contextRequired: "Assess the nature of the weakness (process gap vs. systematic failure), whether it is isolated or pervasive, and whether management has a credible remediation plan.",
  },
  {
    checkKey: "fraud_whistleblower",
    category: "auditor",
    description: "Investigate whether there are disclosed whistleblower complaints, suspected fraud, accounting irregularities, regulatory investigations or SEBI/MCA/SFIO actions related to financial reporting.",
    relevanceNote: "Apply only when such disclosures exist in the annual report, stock exchange filings or credible public domain. Do not speculate.",
    notAutomaticRedFlag: true,
    contextRequired: "Distinguish substantiated findings from unresolved allegations. Assess management response, board audit committee action and regulatory outcome.",
  },

  // ── CONSOLIDATED ANALYSIS ────────────────────────────────────
  {
    checkKey: "minority_interest_quality",
    category: "consolidated",
    description: "Assess how much of consolidated PAT belongs to shareholders of the parent versus minority (non-controlling) interests. Evaluate whether PAT attributable to the parent is growing in line with headline consolidated numbers.",
    relevanceNote: "Apply to all companies with material subsidiaries. Critical for conglomerates, holding companies and groups with joint ventures.",
    notAutomaticRedFlag: true,
    contextRequired: "A high minority interest share is not inherently bad — it reflects partial ownership. The concern arises when profit attributable to the parent grows slowly despite strong consolidated numbers, or when structure shifts profitable entities away from the listed parent.",
  },
  {
    checkKey: "subsidiary_earnings_drivers",
    category: "consolidated",
    description: "Identify which subsidiaries, joint ventures or associates are driving consolidated earnings. Assess whether those entities are generating real cash or primarily contributing accounting profits (equity accounting, unrealised fair value gains).",
    relevanceNote: "Apply when the group has material subsidiaries, associates or JVs whose profitability is consolidated but whose cash dividends to the parent are limited.",
    notAutomaticRedFlag: true,
    contextRequired: "Compare dividends received from associates/JVs with the equity-accounted profit recognised. A large and growing gap between accounted profit and cash received warrants scrutiny.",
  },
  {
    checkKey: "subsidiary_capital_consumption",
    category: "consolidated",
    description: "Assess whether subsidiaries or JVs are consuming disproportionate amounts of capital relative to the returns they generate. Identify intra-group loans, capital infusions and guarantees.",
    relevanceNote: "Apply when the group has multiple subsidiaries with independent balance sheets, or when intra-group transactions are material.",
    notAutomaticRedFlag: true,
    contextRequired: "Capital infusion into a new business in investment phase is structurally different from repeated infusions into a loss-making legacy entity. Assess strategic rationale and time-to-return.",
  },

  // ── CAPITAL ALLOCATION ───────────────────────────────────────
  {
    checkKey: "incremental_roce",
    category: "capital_allocation",
    description: "Compute incremental ROCE or ROIC — the return generated on capital deployed in the most recent period, not the historical average. Assess whether new capital is being deployed as productively as existing capital.",
    relevanceNote: "Apply to all capital-intensive businesses. Especially important during expansion phases where absolute returns may look stable but marginal returns are declining.",
    notAutomaticRedFlag: true,
    contextRequired: "A declining incremental ROCE during heavy investment in a genuinely high-growth opportunity is different from declining returns on mature assets. Assess the business rationale and expected return timeline.",
  },
  {
    checkKey: "acquisition_value",
    category: "capital_allocation",
    description: "Assess whether acquisitions have created or destroyed shareholder value. Examine the acquisition price, goodwill recognised, subsequent impairments and whether acquired businesses have met their original rationale.",
    relevanceNote: "Apply whenever the company has made material acquisitions. Goodwill impairment, integration charges and post-acquisition margin deterioration are investigative signals.",
    notAutomaticRedFlag: true,
    contextRequired: "Distinguish strategic acquisitions with a clear long-term rationale (and adequate time to assess) from acquisitions that have already underperformed their stated thesis over a reasonable period.",
  },
  {
    checkKey: "retained_cash_deployment",
    category: "capital_allocation",
    description: "Assess whether retained earnings and free cash flow are being deployed productively. Evaluate the split between reinvestment, acquisitions, debt repayment, dividends and buybacks, and whether each deployment has generated adequate returns.",
    relevanceNote: "Apply to cash-generative businesses where the balance sheet has accumulated significant cash or investments, or when dividend or buyback policy has changed.",
    notAutomaticRedFlag: true,
    contextRequired: "Retained cash on the balance sheet is not automatically inefficient. A company saving for a capex cycle or avoiding forced fundraising at bad terms is rational. Assess deployment against stated strategy.",
  },

  // ── SHAREHOLDER ECONOMICS ────────────────────────────────────
  {
    checkKey: "share_count_dilution",
    category: "shareholder_economics",
    description: "Investigate whether the number of outstanding shares has increased materially. Identify the mechanism: QIPs, preferential allotments, warrants, convertible instruments, ESOPs, rights issues or bonus shares with offsetting equity reduction.",
    relevanceNote: "Apply whenever the share count has changed materially year-over-year or when the company has issued QIPs, warrants or convertibles.",
    notAutomaticRedFlag: true,
    contextRequired: "Assess the purpose (growth capital with a clear use of funds vs. dilution to repay debt or fund losses), the pricing relative to market, and whether the board has been transparent about dilution to existing shareholders.",
  },
  {
    checkKey: "eps_vs_pat",
    category: "shareholder_economics",
    description: "Compare EPS growth against PAT growth. A significant and persistent gap indicates dilution: total profit is growing but the per-share economic interest of existing shareholders is growing more slowly.",
    relevanceNote: "Apply whenever PAT growth and EPS growth diverge by more than a few percentage points in the same period.",
    notAutomaticRedFlag: true,
    contextRequired: "Distinguish dilution from ESOP exercises (gradual, disclosed) from large equity issuances that materially reset the share base. Assess whether the capital raised generated returns adequate to compensate existing shareholders.",
  },

  // ── MANAGEMENT ───────────────────────────────────────────────
  {
    checkKey: "management_explanation_consistency",
    category: "management",
    description: "Assess whether management's explanation for the same past event has changed over time across quarterly calls, annual reports and investor presentations. Inconsistent explanations of what went wrong in prior periods reduce credibility.",
    relevanceNote: "Apply when tracking management commentary across multiple periods. Requires comparing current explanations with prior-period transcripts or disclosures.",
    notAutomaticRedFlag: true,
    contextRequired: "Distinguish genuine new information that legitimately changes the explanation from post-hoc rationalisation of missed targets. Pattern across multiple periods matters more than a single revision.",
  },
  {
    checkKey: "management_failure_transparency",
    category: "management",
    description: "Assess whether management acknowledges missed targets, business failures and unfavourable developments transparently, or whether disclosures are consistently framed to minimise negatives.",
    relevanceNote: "Apply by reviewing language in results presentations, annual report MD&As and investor call transcripts. Consistent blame-shifting or omission of missed metrics is a signal.",
    notAutomaticRedFlag: true,
    contextRequired: "Management that acknowledges errors and explains the corrective action is more credible than management that never reports a failure. Look for pattern, not isolated instances.",
  },
  {
    checkKey: "management_remuneration_alignment",
    category: "management",
    description: "Assess whether management remuneration (salary, commission, variable pay, ESOPs) is aligned with long-term shareholder returns rather than short-term accounting metrics.",
    relevanceNote: "Apply when promoter or professional management remuneration is material relative to PAT, or when remuneration has grown significantly faster than earnings or shareholder returns.",
    notAutomaticRedFlag: true,
    contextRequired: "High absolute remuneration is not automatically problematic — context is competitive labour market, company scale and shareholder returns delivered. The concern is remuneration rising while shareholder returns deteriorate, or remuneration tied only to revenue or EBITDA rather than ROIC or per-share value.",
  },

  // ── CONTINGENT LIABILITIES ───────────────────────────────────
  {
    checkKey: "contingent_liability_materiality",
    category: "contingent_liabilities",
    description: "Assess whether disclosed contingent liabilities (tax demands, legal disputes, guarantees, environmental claims, regulatory penalties) are material relative to the company's net worth, free cash flow and debt capacity.",
    relevanceNote: "Apply when contingent liabilities are disclosed in the notes. Always assess size relative to financial capacity, not in absolute rupee terms alone.",
    notAutomaticRedFlag: true,
    contextRequired: "A contingent liability of ₹500 crore is immaterial for a company with ₹50,000 crore net worth but serious for one with ₹1,000 crore. Assess the nature of the dispute, management's historical win/loss rate and provisions already made.",
  },
  {
    checkKey: "contingent_liability_crystallisation",
    category: "contingent_liabilities",
    description: "For material contingent liabilities, assess the probability and likely timeline of crystallisation into actual cash outflows. Identify whether the company has made adequate provisions and whether adverse outcomes would require external financing.",
    relevanceNote: "Apply when contingent liabilities are material. Requires reading the legal/tax notes and auditor comments, not just the headline figure.",
    notAutomaticRedFlag: true,
    contextRequired: "Distinguish well-established tax demands at a routine appellate stage (typically low crystallisation probability) from liabilities where adverse outcomes have already been determined at lower tribunals.",
  },

  // ── LONG-TERM INVESTMENT ─────────────────────────────────────
  {
    checkKey: "incremental_roic_trajectory",
    category: "long_term",
    description: "Assess whether incremental return on invested capital (ROIC) is improving or deteriorating over a multi-year period. A declining incremental ROIC despite growing absolute profit indicates capital is being deployed at diminishing returns.",
    relevanceNote: "Apply over a multi-year period — at least 3 to 5 years of data. Not useful on a single-year basis.",
    notAutomaticRedFlag: true,
    contextRequired: "Distinguish a temporary dip during a deliberate investment phase (where ROIC is expected to recover) from a structural deterioration with no credible recovery thesis. Management's stated return expectations must be compared to what has been delivered historically.",
  },
  {
    checkKey: "competitive_advantage_trajectory",
    category: "long_term",
    description: "Assess whether the company's competitive advantage (pricing power, cost position, network effects, regulatory moat, switching costs, brand) is strengthening or weakening. Use observable evidence: market share trends, margin trends relative to peers, customer retention.",
    relevanceNote: "Apply in the outlook and industry sections. Requires peer context and multi-year data.",
    notAutomaticRedFlag: true,
    contextRequired: "A temporarily weaker margin during an investment cycle is not the same as permanent competitive erosion. Look for durable structural signals: entry of a well-funded new competitor, commoditisation of a differentiated product, regulatory changes removing a moat.",
  },
  {
    checkKey: "thesis_invalidation_evidence",
    category: "long_term",
    description: "Explicitly identify what evidence would invalidate or materially weaken the current investment thesis for this company. State the conditions: if X happens, the thesis breaks. Then assess whether any of those conditions are emerging.",
    relevanceNote: "Apply in the investor takeaway section for long-term oriented analysis. The AI must be able to articulate what would make it wrong.",
    notAutomaticRedFlag: true,
    contextRequired: "Thesis invalidation conditions must be specific to this company and its industry — not generic risk statements. Generic risks that apply to every company (inflation, recession, regulation) are not useful thesis invalidation criteria.",
  },
];

/**
 * Returns the universal research checks.
 * These apply to every company regardless of industry framework.
 * The AI must evaluate relevance before applying each check.
 */
export function getResearchChecks(): ResearchCheck[] {
  return UNIVERSAL_RESEARCH_CHECKS;
}

/**
 * Returns research checks filtered to a specific category.
 */
export function getResearchChecksByCategory(
  category: ResearchCheckCategory,
): ResearchCheck[] {
  return UNIVERSAL_RESEARCH_CHECKS.filter((c) => c.category === category);
}
