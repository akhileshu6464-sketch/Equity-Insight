-- StockLens — Migration 002: Internal Research Checks
-- Adds the research_checks column to industry_frameworks and populates
-- universal internal AI investigation rules.
-- Run after migration_001_ai_research_engine.sql.

-- ─────────────────────────────────────────────────────────────
-- 1. Add research_checks column to industry_frameworks
--    (idempotent — safe to run on a database that already has it)
-- ─────────────────────────────────────────────────────────────
alter table public.industry_frameworks
  add column if not exists research_checks jsonb not null default '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────
-- 2. Add three new cross-check rules to the default framework.
--    New rules (metric-pair comparisons not present in migration 001):
--      eps_vs_pat_growth   — detects share-count dilution
--      other_income_vs_pat — detects profit quality: non-core income
--      exceptional_vs_pat  — detects reliance on non-recurring items
-- ─────────────────────────────────────────────────────────────
update public.industry_frameworks
set
  cross_check_rules = cross_check_rules || '[
    {
      "rule_key": "eps_vs_pat_growth",
      "description": "EPS growth vs PAT growth — detects share-count dilution",
      "metric_a": "eps_growth",
      "metric_b": "pat_growth",
      "expected_relationship": "EPS growing materially slower than PAT indicates dilution from QIPs, warrants, ESOPs or preferential allotments; investigate the cause and whether existing shareholders are bearing the cost"
    },
    {
      "rule_key": "other_income_vs_pat",
      "description": "Other income as a proportion of reported PAT",
      "metric_a": "other_income",
      "metric_b": "pat",
      "expected_relationship": "Other income (interest, dividends, asset sales, forex gains) consistently exceeding 20-25% of PAT shifts the profit source away from core operations; assess sustainability and recurrence"
    },
    {
      "rule_key": "exceptional_vs_pat",
      "description": "Exceptional and non-recurring items relative to reported PAT",
      "metric_a": "exceptional_items",
      "metric_b": "pat",
      "expected_relationship": "Significant exceptional gains or losses require the AI to compute adjusted PAT and assess the underlying operating trend; a one-time gain is not automatically a red flag but must not be treated as recurring"
    }
  ]'::jsonb,
  updated_at = now()
where industry_type = 'default';

-- ─────────────────────────────────────────────────────────────
-- 3. Populate research_checks for the default framework.
--    These are INTERNAL AI INVESTIGATION RULES — they must never
--    appear as questions in the user-facing report.
--    The AI must decide which checks are relevant to the specific
--    company, industry and situation before applying them.
--    Context, materiality and duration determine the conclusion,
--    not the mere existence of a condition.
-- ─────────────────────────────────────────────────────────────
update public.industry_frameworks
set
  research_checks = '[
    {
      "check_key": "accounting_policy_changes",
      "category": "accounting",
      "description": "Investigate whether the company changed accounting policies or material accounting estimates (depreciation, useful lives, revenue recognition, inventory valuation) and whether those changes materially affected reported earnings.",
      "relevance_note": "Apply when the notes to accounts or auditor report flag a change, or when margins shift sharply without an obvious operational explanation.",
      "not_automatic_red_flag": true,
      "context_required": "Determine whether the change was driven by a genuine shift in business reality, regulatory alignment (Ind AS transition, SEBI mandate) or earnings management. Quantify the impact before concluding."
    },
    {
      "check_key": "exceptional_items_quality",
      "category": "accounting",
      "description": "Quantify exceptional and non-recurring items (asset disposals, impairments, litigation settlements, restructuring charges, forex gains/losses on debt). Compute adjusted PAT excluding these items and assess the underlying operating trend.",
      "relevance_note": "Always apply. Recurring reliance on exceptional gains to report profit growth is a concern; a one-time write-down of a genuinely impaired asset is not.",
      "not_automatic_red_flag": true,
      "context_required": "Assess whether the item is truly non-recurring, whether it recurs in multiple periods, and whether management is transparent about it."
    },
    {
      "check_key": "other_income_quality",
      "category": "accounting",
      "description": "Assess how much of reported profit comes from other income (interest income on surplus cash, dividends from subsidiaries, profit on asset sales, rental income, forex translation gains) rather than the core operating business.",
      "relevance_note": "Apply when other income is a material proportion of reported PAT. Especially important for holding companies, cash-rich businesses and conglomerates.",
      "not_automatic_red_flag": true,
      "context_required": "Distinguish structural other income (e.g., interest on a genuinely cash-rich treasury) from non-recurring items misclassified as other income. Assess recurrence and cash realisation."
    },
    {
      "check_key": "auditor_change",
      "category": "auditor",
      "description": "Investigate whether the statutory auditor changed or resigned during or just after the period. Establish the stated reason, the timing relative to financial results, and whether the incoming auditor is of similar standing.",
      "relevance_note": "Apply whenever an auditor change is noted. An auditor change following a management dispute, qualification or regulatory inquiry carries more weight than a routine rotation.",
      "not_automatic_red_flag": true,
      "context_required": "Distinguish mandatory rotation (regulatory requirement) from voluntary change or resignation. A resignation mid-year or shortly before results is more significant than a scheduled change."
    },
    {
      "check_key": "restatements",
      "category": "auditor",
      "description": "Identify whether prior-period financial statements were restated, the magnitude of the restatement, and the stated reason. Assess whether the restatement affects the investment thesis materially.",
      "relevance_note": "Apply whenever the current-year accounts include restated prior-year comparatives that differ from previously published figures.",
      "not_automatic_red_flag": true,
      "context_required": "Determine whether the restatement relates to an error, a regulatory correction, or a genuine reassessment. Magnitude and pattern (repeated restatements) determine severity."
    },
    {
      "check_key": "internal_control_weaknesses",
      "category": "auditor",
      "description": "Identify material weaknesses in internal financial controls reported by the auditor or management, and assess whether they have been remediated in subsequent periods.",
      "relevance_note": "Apply when the auditor report contains qualifications, emphasis of matter paragraphs, or an adverse opinion on internal controls.",
      "not_automatic_red_flag": true,
      "context_required": "Assess the nature of the weakness (process gap vs. systematic failure), whether it is isolated or pervasive, and whether management has a credible remediation plan."
    },
    {
      "check_key": "fraud_whistleblower",
      "category": "auditor",
      "description": "Investigate whether there are disclosed whistleblower complaints, suspected fraud, accounting irregularities, regulatory investigations or SEBI/MCA/SFIO actions related to financial reporting.",
      "relevance_note": "Apply only when such disclosures exist in the annual report, stock exchange filings or credible public domain. Do not speculate.",
      "not_automatic_red_flag": true,
      "context_required": "Distinguish substantiated findings from unresolved allegations. Assess management response, board audit committee action and regulatory outcome."
    },
    {
      "check_key": "minority_interest_quality",
      "category": "consolidated",
      "description": "Assess how much of consolidated PAT belongs to shareholders of the parent versus minority (non-controlling) interests. Evaluate whether PAT attributable to the parent is growing in line with headline consolidated numbers.",
      "relevance_note": "Apply to all companies with material subsidiaries. Critical for conglomerates, holding companies and groups with joint ventures.",
      "not_automatic_red_flag": true,
      "context_required": "A high minority interest share is not inherently bad — it reflects partial ownership. The concern arises when profit attributable to the parent grows slowly despite strong consolidated numbers, or when minority interest is structured to shift profitable entities away from the listed parent."
    },
    {
      "check_key": "subsidiary_earnings_drivers",
      "category": "consolidated",
      "description": "Identify which subsidiaries, joint ventures or associates are driving consolidated earnings. Assess whether those entities are generating real cash or primarily contributing accounting profits (equity accounting, unrealised fair value gains).",
      "relevance_note": "Apply when the group has material subsidiaries, associates or JVs whose profitability is consolidated but whose cash dividends to the parent are limited.",
      "not_automatic_red_flag": true,
      "context_required": "Compare dividends received from associates/JVs with the equity-accounted profit recognised. A large and growing gap between accounted profit and cash received warrants scrutiny."
    },
    {
      "check_key": "subsidiary_capital_consumption",
      "category": "consolidated",
      "description": "Assess whether subsidiaries or JVs are consuming disproportionate amounts of capital relative to the returns they generate. Identify intra-group loans, capital infusions and guarantees.",
      "relevance_note": "Apply when the group has multiple subsidiaries with independent balance sheets, or when intra-group transactions are material.",
      "not_automatic_red_flag": true,
      "context_required": "Capital infusion into a new business in investment phase is structurally different from repeated infusions into a loss-making legacy entity. Assess strategic rationale and time-to-return."
    },
    {
      "check_key": "incremental_roce",
      "category": "capital_allocation",
      "description": "Compute incremental ROCE or ROIC — the return generated on capital deployed in the most recent period, not the historical average. Assess whether new capital is being deployed as productively as existing capital.",
      "relevance_note": "Apply to all capital-intensive businesses. Especially important during expansion phases where absolute returns may look stable but marginal returns are declining.",
      "not_automatic_red_flag": true,
      "context_required": "A declining incremental ROCE during heavy investment in a genuinely high-growth opportunity is different from declining returns on mature assets. Assess the business rationale and the expected return timeline."
    },
    {
      "check_key": "acquisition_value",
      "category": "capital_allocation",
      "description": "Assess whether acquisitions made in the current or recent periods have created or destroyed shareholder value. Examine the acquisition price paid, the goodwill recognised, subsequent impairments and whether acquired businesses have met their original rationale.",
      "relevance_note": "Apply whenever the company has made material acquisitions. Goodwill impairment, integration charges and post-acquisition margin deterioration are investigative signals.",
      "not_automatic_red_flag": true,
      "context_required": "Distinguish strategic acquisitions with a clear long-term rationale (and adequate time to assess) from acquisitions that have already underperformed their stated thesis over a reasonable period."
    },
    {
      "check_key": "retained_cash_deployment",
      "category": "capital_allocation",
      "description": "Assess whether retained earnings and free cash flow are being deployed productively. Evaluate the split between reinvestment, acquisitions, debt repayment, dividends and share buybacks, and whether each deployment has generated adequate returns.",
      "relevance_note": "Apply to cash-generative businesses where the balance sheet has accumulated significant cash or investments. Also apply when dividend or buyback policy has changed.",
      "not_automatic_red_flag": true,
      "context_required": "Retained cash on the balance sheet is not automatically inefficient — a company saving for a capex cycle or avoiding forced fundraising at bad terms is rational. Assess deployment against stated strategy."
    },
    {
      "check_key": "share_count_dilution",
      "category": "shareholder_economics",
      "description": "Investigate whether the number of outstanding shares has increased materially. Identify the mechanism: QIPs, preferential allotments, warrants, convertible instruments, ESOPs, rights issues or bonus shares with offsetting equity reduction.",
      "relevance_note": "Apply whenever the share count has changed materially year-over-year or when the company has issued QIPs, warrants or convertibles.",
      "not_automatic_red_flag": true,
      "context_required": "Assess the purpose (growth capital with a clear use of funds vs. dilution to repay debt or fund losses), the pricing relative to market (at discount or premium), and whether the board has been transparent about dilution to existing shareholders."
    },
    {
      "check_key": "eps_vs_pat",
      "category": "shareholder_economics",
      "description": "Compare EPS growth against PAT growth. A significant and persistent gap indicates dilution: total profit is growing but the per-share economic interest of existing shareholders is growing more slowly.",
      "relevance_note": "Apply whenever PAT growth and EPS growth diverge by more than a few percentage points in the same period.",
      "not_automatic_red_flag": true,
      "context_required": "Distinguish dilution from ESOP exercises (gradual, disclosed) from large equity issuances that materially reset the share base. Assess whether the capital raised generated returns adequate to compensate existing shareholders."
    },
    {
      "check_key": "management_explanation_consistency",
      "category": "management",
      "description": "Assess whether management''s explanation for the same past event has changed over time across quarterly calls, annual reports and investor presentations. Inconsistent explanations of what went wrong in prior periods reduce credibility.",
      "relevance_note": "Apply when tracking management commentary across multiple periods. Requires comparing current explanations with prior-period transcripts or disclosures.",
      "not_automatic_red_flag": true,
      "context_required": "Distinguish genuine new information that legitimately changes the explanation (e.g., a macro event that was not foreseeable) from post-hoc rationalisation of missed targets. Pattern across multiple periods matters more than a single revision."
    },
    {
      "check_key": "management_failure_transparency",
      "category": "management",
      "description": "Assess whether management acknowledges missed targets, business failures and unfavourable developments transparently, or whether disclosures are consistently framed to minimise negatives.",
      "relevance_note": "Apply by reviewing language in results presentations, annual report MD&As and investor call transcripts. Consistent use of passive voice, blame-shifting or omission of missed metrics is a signal.",
      "not_automatic_red_flag": true,
      "context_required": "Management that acknowledges errors and explains the corrective action is more credible than management that never reports a failure. Look for pattern, not isolated instances."
    },
    {
      "check_key": "management_remuneration_alignment",
      "category": "management",
      "description": "Assess whether management remuneration (salary, commission, variable pay, ESOPs) is aligned with long-term shareholder returns rather than short-term accounting metrics.",
      "relevance_note": "Apply when promoter or professional management remuneration is material relative to PAT, or when remuneration has grown significantly faster than earnings or shareholder returns.",
      "not_automatic_red_flag": true,
      "context_required": "High absolute remuneration is not automatically problematic — context is competitive labour market, company scale and shareholder returns delivered. The concern is remuneration rising while shareholder returns deteriorate, or remuneration tied only to revenue or EBITDA rather than ROIC or per-share value."
    },
    {
      "check_key": "contingent_liability_materiality",
      "category": "contingent_liabilities",
      "description": "Assess whether disclosed contingent liabilities (tax demands, legal disputes, guarantees, environmental claims, regulatory penalties) are material relative to the company''s net worth, free cash flow and debt capacity.",
      "relevance_note": "Apply when contingent liabilities are disclosed in the notes. Always assess size relative to financial capacity, not in absolute rupee terms alone.",
      "not_automatic_red_flag": true,
      "context_required": "A contingent liability of Rs 500 crore is immaterial for a company with Rs 50,000 crore net worth but serious for one with Rs 1,000 crore. Assess the nature of the dispute, management''s historical win/loss rate and provisions already made."
    },
    {
      "check_key": "contingent_liability_crystallisation",
      "category": "contingent_liabilities",
      "description": "For material contingent liabilities, assess the probability and likely timeline of crystallisation into actual cash outflows. Identify whether the company has made adequate provisions and whether adverse outcomes would require external financing.",
      "relevance_note": "Apply when contingent liabilities are material. Requires reading the legal/tax notes and auditor comments, not just the headline figure.",
      "not_automatic_red_flag": true,
      "context_required": "Distinguish well-established tax demands at a routine appellate stage (typically low crystallisation probability) from liabilities where adverse outcomes have already been determined at lower tribunals or where management has stated provisions are unlikely to suffice."
    },
    {
      "check_key": "incremental_roic_trajectory",
      "category": "long_term",
      "description": "Assess whether incremental return on invested capital (ROIC) is improving or deteriorating over a multi-year period. A declining incremental ROIC despite growing absolute profit indicates capital is being deployed at diminishing returns.",
      "relevance_note": "Apply over a multi-year period — at least 3 to 5 years of data. Not useful on a single-year basis.",
      "not_automatic_red_flag": true,
      "context_required": "Distinguish a temporary dip during a deliberate investment phase (where ROIC is expected to recover) from a structural deterioration with no credible recovery thesis. Management''s stated return expectations for incremental capital must be compared to what has been delivered historically."
    },
    {
      "check_key": "competitive_advantage_trajectory",
      "category": "long_term",
      "description": "Assess whether the company''s competitive advantage (pricing power, cost position, network effects, regulatory moat, switching costs, brand) is strengthening or weakening. Use observable evidence: market share trends, margin trends relative to peers, customer retention.",
      "relevance_note": "Apply in the outlook and industry sections. Requires peer context and multi-year data.",
      "not_automatic_red_flag": true,
      "context_required": "A temporarily weaker margin during an investment cycle is not the same as permanent competitive erosion. Look for durable structural signals: entry of a well-funded new competitor, commoditisation of a previously differentiated product, regulatory changes removing a moat."
    },
    {
      "check_key": "thesis_invalidation_evidence",
      "category": "long_term",
      "description": "Explicitly identify what evidence would invalidate or materially weaken the current investment thesis for this company. State the conditions: if X happens, the thesis breaks. Then assess whether any of those conditions are emerging.",
      "relevance_note": "Apply in the investor takeaway section for long-term oriented analysis. This is a discipline check: the AI must be able to articulate what would make it wrong.",
      "not_automatic_red_flag": true,
      "context_required": "The thesis invalidation conditions must be specific to this company and its industry — not generic risk statements. Generic risks that apply to every company (inflation, recession, regulation) are not useful thesis invalidation criteria."
    }
  ]'::jsonb,
  updated_at = now()
where industry_type = 'default';

-- ─────────────────────────────────────────────────────────────
-- 4. Propagate research_checks to all other industry frameworks.
--    Each specialised framework inherits the universal checks.
--    Industry-specific checks can be added separately if needed.
-- ─────────────────────────────────────────────────────────────
update public.industry_frameworks
set
  research_checks = (
    select research_checks
    from public.industry_frameworks
    where industry_type = 'default'
  ),
  updated_at = now()
where industry_type in ('bank', 'epc', 'manufacturing', 'it_services', 'conglomerate');
