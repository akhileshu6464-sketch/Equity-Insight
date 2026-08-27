import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, ArrowLeft, ArrowUpRight, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { Header, Footer } from '@/components/stocklens-ui';

interface ResearchSection {
  id: string;
  section: string;
  title: string;
  content: string;
  last_updated?: string;
}

interface CompanyResearchPayload {
  company: {
    id: string;
    ticker: string;
    name: string;
    industry_type?: string | null;
  };
  research: ResearchSection[];
}

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ||
  (import.meta.env.REACT_APP_BACKEND_URL as string | undefined) ||
  '';

async function fetchResearch(ticker: string): Promise<CompanyResearchPayload> {
  const url = `${BACKEND_URL}/api/companies/${encodeURIComponent(ticker)}/research?ts=${Date.now()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`Failed to load research (${res.status})`);
  return res.json();
}

const SECTION_GROUPS: Array<{
  label: string;
  items: Array<{ key: string; title: string }>;
}> = [
  {
    label: 'Executive',
    items: [
      { key: 'executive_summary', title: 'Executive Summary' },
      { key: 'investment_thesis', title: 'Investment Thesis' },
    ],
  },
  {
    label: 'Business & Industry',
    items: [
      { key: 'business_overview', title: 'Business Overview' },
      { key: 'industry_context', title: 'Industry Context' },
      { key: 'competitive_position', title: 'Competitive Position' },
      { key: 'segment_analysis', title: 'Segment Analysis' },
      { key: 'what_changed', title: 'What Changed This Year' },
    ],
  },
  {
    label: 'Financials',
    items: [
      { key: 'historical_financials', title: 'Historical Financial Analysis' },
      { key: 'financial_ratios', title: 'Financial Ratios' },
    ],
  },
  {
    label: 'Cash Flow & Balance Sheet',
    items: [
      { key: 'cash_flow_analysis', title: 'Cash Flow Analysis' },
      { key: 'balance_sheet_analysis', title: 'Balance Sheet Analysis' },
      { key: 'receivables_analysis', title: 'Receivables' },
      { key: 'inventory_analysis', title: 'Inventory' },
      { key: 'payables_analysis', title: 'Payables' },
      { key: 'working_capital_analysis', title: 'Working Capital' },
      { key: 'debt_liquidity', title: 'Debt & Liquidity' },
    ],
  },
  {
    label: 'Management & Strategy',
    items: [
      { key: 'management_analysis', title: 'Management Commentary' },
      { key: 'strategy_capital_allocation', title: 'Strategy & Capital Allocation' },
      { key: 'guidance_outlook', title: 'Guidance & Outlook' },
      { key: 'guidance_vs_execution', title: 'Guidance vs Execution' },
    ],
  },
  {
    label: 'RPT & Governance',
    items: [
      { key: 'related_party_transactions', title: 'Related-Party Transactions' },
      { key: 'shareholding_ownership', title: 'Shareholding & Ownership' },
      { key: 'governance_analysis', title: 'Governance' },
      { key: 'subsidiaries_jvs', title: 'Subsidiaries & JVs' },
    ],
  },
  {
    label: 'Auditor & Accounting',
    items: [
      { key: 'auditor_analysis', title: 'Auditor Analysis' },
      { key: 'accounting_analysis', title: 'Accounting Analysis' },
    ],
  },
  {
    label: 'Risks, Catalysts, Monitoring',
    items: [
      { key: 'material_risks', title: 'Material Risks' },
      { key: 'catalysts_positives', title: 'Catalysts & Positive Developments' },
      { key: 'investor_monitoring_points', title: 'Investor Monitoring Points' },
      { key: 'final_investor_takeaway', title: 'Final Investor Takeaway' },
    ],
  },
];

interface ParsedTable {
  title?: string;
  headers: string[];
  rows: string[][];
  footnote?: string;
}

interface ContentBlock {
  kind: 'narrative' | 'table' | 'findings';
  text?: string;
  table?: ParsedTable;
}

function parseSectionContent(raw: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const tableRegex = /\[TABLE\](\{[\s\S]*?\})\[\/TABLE\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(raw)) !== null) {
    const before = raw.slice(cursor, match.index).trim();
    if (before) blocks.push({ kind: 'narrative', text: before });
    try {
      const table = JSON.parse(match[1]!) as ParsedTable;
      if (Array.isArray(table.headers) && Array.isArray(table.rows)) {
        blocks.push({ kind: 'table', table });
      }
    } catch {
      // ignore malformed table
    }
    cursor = match.index + match[0].length;
  }
  const rest = raw.slice(cursor).trim();
  if (rest) blocks.push({ kind: 'narrative', text: rest });

  // Split "--- Detailed findings ---" out of narrative blocks
  const final: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.kind === 'narrative' && b.text) {
      const parts = b.text.split(/\n?---\s*Detailed findings\s*---\n?/i);
      if (parts.length > 1) {
        if (parts[0]?.trim()) final.push({ kind: 'narrative', text: parts[0].trim() });
        for (let i = 1; i < parts.length; i += 1) {
          const chunk = parts[i]?.trim();
          if (chunk) final.push({ kind: 'findings', text: chunk });
        }
      } else {
        final.push(b);
      }
    } else {
      final.push(b);
    }
  }
  return final;
}

function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\n\s*\n/).filter(Boolean);
  return (
    <div className="space-y-4">
      {paras.map((p, i) => (
        <p key={i} className="text-[15px] leading-[1.75] text-[hsl(var(--foreground))]">
          {p.trim()}
        </p>
      ))}
    </div>
  );
}

function TableBlock({ table }: { table: ParsedTable }) {
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-[hsl(var(--border))]">
      {table.title && (
        <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.4)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
          {table.title}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-[hsl(var(--secondary)/.3)] text-[hsl(var(--muted-foreground))]">
          <tr>
            {table.headers.map((h, i) => (
              <th key={i} className="px-5 py-3 text-left font-semibold uppercase tracking-wide text-[11px]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-t border-[hsl(var(--border))]">
              {r.map((c, j) => (
                <td key={j} className="px-5 py-3 align-top text-[hsl(var(--foreground))]">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.footnote && (
        <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.3)] px-5 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          {table.footnote}
        </div>
      )}
    </div>
  );
}

function FindingsBlock({ text }: { text: string }) {
  // Findings are separated by blank lines. Each finding has multiple lines:
  //   fact
  //   Analysis: ...
  //   Investor implication: ...
  //   Calculations: ...
  //   [Fact · high confidence · consolidated · Source: annual report]
  const findings = text.split(/\n\s*\n/).filter((f) => f.trim());
  return (
    <div className="mt-6 space-y-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
        Detailed findings
      </p>
      {findings.map((f, i) => {
        const lines = f.split('\n');
        const first = lines[0]?.trim() ?? '';
        const metaLine = lines[lines.length - 1]?.trim() ?? '';
        const metaMatch = metaLine.match(/^\[(.+)\]$/);
        const meta = metaMatch ? metaMatch[1] : '';
        const bodyLines = metaMatch ? lines.slice(1, -1) : lines.slice(1);

        return (
          <div
            key={i}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"
            data-testid={`finding-${i}`}
          >
            <p className="text-[15px] font-semibold leading-snug text-[hsl(var(--foreground))]">{first}</p>
            <div className="mt-3 space-y-2 text-[14px] leading-relaxed text-[hsl(var(--muted-foreground))]">
              {bodyLines.map((line, j) => {
                const trimmed = line.trim();
                if (!trimmed) return null;
                if (/^Analysis:/i.test(trimmed))
                  return (
                    <p key={j}>
                      <span className="font-medium text-[hsl(var(--foreground))]">Analysis. </span>
                      {trimmed.replace(/^Analysis:\s*/i, '')}
                    </p>
                  );
                if (/^Investor implication:/i.test(trimmed))
                  return (
                    <p key={j} className="text-[hsl(var(--accent))]">
                      <span className="font-medium">Investor implication. </span>
                      {trimmed.replace(/^Investor implication:\s*/i, '')}
                    </p>
                  );
                if (/^Calculations:/i.test(trimmed)) return null; // handled separately
                if (/^•\s/.test(trimmed))
                  return (
                    <p key={j} className="pl-4 font-mono text-[13px]">
                      {trimmed}
                    </p>
                  );
                return <p key={j}>{trimmed}</p>;
              })}
            </div>
            {meta && (
              <p className="mt-4 text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {meta}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionCard({ id, title, content }: { id: string; title: string; content: string }) {
  const blocks = useMemo(() => parseSectionContent(content), [content]);
  if (!content.trim()) return null;

  return (
    <section
      id={id}
      data-testid={`section-${id}`}
      className="scroll-mt-24 border-b border-[hsl(var(--border))] py-10"
    >
      <div className="mb-6 flex items-baseline gap-4">
        <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          §
        </span>
        <h2 className="font-display text-[26px] leading-tight tracking-[-0.02em] text-[hsl(var(--foreground))] lg:text-[30px]">
          {title}
        </h2>
      </div>
      <div className="space-y-6">
        {blocks.map((b, i) => {
          if (b.kind === 'narrative') return <Paragraphs key={i} text={b.text ?? ''} />;
          if (b.kind === 'table' && b.table) return <TableBlock key={i} table={b.table} />;
          if (b.kind === 'findings') return <FindingsBlock key={i} text={b.text ?? ''} />;
          return null;
        })}
      </div>
    </section>
  );
}

export default function LiveReport({ params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const query = useQuery({
    queryKey: ['live-research', ticker],
    queryFn: () => fetchResearch(ticker),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const sectionByKey = useMemo(() => {
    const m = new Map<string, ResearchSection>();
    (query.data?.research ?? []).forEach((s) => m.set(s.section, s));
    return m;
  }, [query.data]);

  const usedSectionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of SECTION_GROUPS) for (const it of g.items) keys.add(it.key);
    return keys;
  }, []);

  const orphanSections = useMemo(
    () => (query.data?.research ?? []).filter((s) => !usedSectionKeys.has(s.section)),
    [query.data, usedSectionKeys],
  );

  return (
    <div className="min-h-[100dvh] bg-[hsl(var(--background))]">
      <Header report />
      <main className="mx-auto max-w-[1180px] px-5 pb-24 lg:px-10">
        <div className="pt-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
            data-testid="back-home-link"
          >
            <ArrowLeft size={14} /> Back to StockLens
          </Link>
        </div>

        <header className="mt-6 border-b border-[hsl(var(--border))] pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
                <span className="rounded-full border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] px-3 py-1 font-semibold text-[hsl(var(--accent))]">
                  <Sparkles size={12} className="mr-1 inline" /> Multi-agent research
                </span>
                <span>Initiating Coverage · FY2025-26 Annual Report</span>
              </div>
              <h1 className="mt-4 font-display text-[44px] leading-[1.02] tracking-[-0.03em] text-[hsl(var(--foreground))] lg:text-[56px]">
                {query.data?.company.name ?? ticker}
              </h1>
              <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                Executed by seven specialist research agents · Master synthesis · QA validation.
                Every finding is grounded in the ingested annual report, with programmatic
                calculations and preserved consolidated / standalone accounting basis.
              </p>
            </div>
            <Link
              href={`/intelligence/${ticker}`}
              data-testid="link-view-intelligence"
              className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-[13px] font-semibold text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--secondary))]"
            >
              Company intelligence <ArrowUpRight size={14} />
            </Link>
          </div>
        </header>

        {query.isLoading && (
          <div className="flex items-center gap-3 py-16 text-[hsl(var(--muted-foreground))]">
            <Loader2 className="animate-spin" size={18} /> Loading research…
          </div>
        )}

        {query.isError && (
          <div className="my-10 flex items-start gap-3 rounded-xl border border-[hsl(0_75%_45%/.35)] bg-[hsl(0_75%_45%/.08)] p-5 text-[hsl(0_75%_35%)]">
            <AlertTriangle size={18} className="mt-0.5" />
            <div>
              <p className="font-semibold">Failed to load research.</p>
              <p className="mt-1 text-sm">{String(query.error)}</p>
            </div>
          </div>
        )}

        {query.data && (
          <>
            {SECTION_GROUPS.map((group) => {
              const rendered = group.items
                .map((item) => sectionByKey.get(item.key))
                .filter((s): s is ResearchSection => Boolean(s?.content?.trim()));
              if (rendered.length === 0) return null;
              return (
                <div key={group.label} className="mt-10">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--accent))]">
                    {group.label}
                  </p>
                  {rendered.map((s) => {
                    const groupItem = group.items.find((i) => i.key === s.section);
                    return (
                      <SectionCard
                        key={s.section}
                        id={s.section}
                        title={groupItem?.title ?? s.title}
                        content={s.content}
                      />
                    );
                  })}
                </div>
              );
            })}

            {orphanSections.length > 0 && (
              <div className="mt-10">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--accent))]">
                  Additional analysis
                </p>
                {orphanSections.map((s) => (
                  <SectionCard key={s.section} id={s.section} title={s.title} content={s.content} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
