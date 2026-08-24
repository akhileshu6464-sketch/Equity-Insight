import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Loader2,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  ExternalLink,
  FileText,
  Newspaper,
  ShieldCheck,
  ClipboardList,
  Presentation,
  Mic,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Header, Footer } from '@/components/stocklens-ui';

type SourceType =
  | 'annual_report'
  | 'concall'
  | 'credit_rating'
  | 'filing'
  | 'investor_presentation'
  | 'news';

interface IntelligenceItem {
  id: string;
  sourceType: SourceType;
  title: string;
  summary?: string | null;
  publishedAt?: string | null;
  publisher?: string | null;
  category?: string | null;
  originalUrl?: string | null;
  documentUrl?: string | null;
  quarter?: string | null;
  financialYear?: string | null;
  status?: string | null;
  relevanceScore?: number | null;
}

interface CompanyIntelligencePayload {
  company: { id: string; ticker: string; name: string };
  counts: Record<SourceType, number>;
  items: IntelligenceItem[];
}

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ||
  (import.meta.env.REACT_APP_BACKEND_URL as string | undefined) ||
  '';

async function fetchIntelligence(ticker: string): Promise<CompanyIntelligencePayload> {
  const res = await fetch(
    `${BACKEND_URL}/api/intelligence/${encodeURIComponent(ticker)}?ts=${Date.now()}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Failed to load intelligence (${res.status})`);
  return res.json();
}

async function triggerDiscovery(ticker: string) {
  const res = await fetch(
    `${BACKEND_URL}/api/intelligence/${encodeURIComponent(ticker)}/discover`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ daysBackNews: 30, daysBackFilings: 365 }),
    },
  );
  if (!res.ok) throw new Error(`Discovery failed (${res.status})`);
  return res.json();
}

const TABS: Array<{
  key: 'all' | SourceType;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { key: 'all', label: 'All', icon: Sparkles },
  { key: 'annual_report', label: 'Annual Reports', icon: FileText },
  { key: 'concall', label: 'Concalls', icon: Mic },
  { key: 'credit_rating', label: 'Credit Ratings', icon: ShieldCheck },
  { key: 'filing', label: 'Filings', icon: ClipboardList },
  { key: 'investor_presentation', label: 'IR Decks', icon: Presentation },
  { key: 'news', label: 'News', icon: Newspaper },
];

function iconFor(type: SourceType) {
  const found = TABS.find((t) => t.key === type);
  return found?.icon ?? FileText;
}

function friendly(type: SourceType) {
  return TABS.find((t) => t.key === type)?.label ?? type;
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ItemCard({ item }: { item: IntelligenceItem }) {
  const Icon = iconFor(item.sourceType);
  const url = item.documentUrl ?? item.originalUrl ?? undefined;
  return (
    <article
      className="group relative flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_hsl(var(--foreground)/.08)]"
      data-testid={`intel-item-${item.id}`}
    >
      <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
        <span className="inline-flex items-center gap-2">
          <Icon size={13} /> {friendly(item.sourceType)}
        </span>
        <span className="font-mono">{formatDate(item.publishedAt)}</span>
      </div>
      <h3 className="text-[15px] font-semibold leading-snug text-[hsl(var(--foreground))]">
        {item.title}
      </h3>
      {item.summary && (
        <p className="text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          {item.summary}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[12px] text-[hsl(var(--muted-foreground))]">
        <span className="truncate">{item.publisher ?? '—'}</span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--accent))] hover:underline"
            data-testid={`intel-link-${item.id}`}
          >
            View source <ExternalLink size={12} />
          </a>
        )}
      </div>
    </article>
  );
}

export default function Intelligence({ params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const client = useQueryClient();
  const [tab, setTab] = useState<'all' | SourceType>('all');
  const [flash, setFlash] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['intelligence', ticker],
    queryFn: () => fetchIntelligence(ticker),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const discover = useMutation({
    mutationFn: () => triggerDiscovery(ticker),
    onSuccess: (report) => {
      setFlash(
        `Discovery complete — ${report.totalStored} new item${report.totalStored === 1 ? '' : 's'} stored.`,
      );
      client.invalidateQueries({ queryKey: ['intelligence', ticker] });
      setTimeout(() => setFlash(null), 5000);
    },
    onError: (err) => setFlash(`Discovery failed — ${String(err)}`),
  });

  const filteredItems = useMemo(() => {
    const items = query.data?.items ?? [];
    return tab === 'all' ? items : items.filter((i) => i.sourceType === tab);
  }, [query.data, tab]);

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
          <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            <span className="rounded-full border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] px-3 py-1 font-semibold text-[hsl(var(--accent))]">
              <Sparkles size={12} className="mr-1 inline" /> Company intelligence
            </span>
            <span>Auto-discovered sources · continuously updated</span>
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[44px] leading-[1.02] tracking-[-0.03em] text-[hsl(var(--foreground))] lg:text-[56px]">
                {query.data?.company.name ?? ticker}
              </h1>
              <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                Every filing, credit action, IR deck, concall and material news headline
                collected automatically from permitted public sources and fed to the
                seven-specialist research engine.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/live-report/${ticker}`}
                data-testid="link-view-report"
                className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-[13px] font-semibold text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--secondary))]"
              >
                View research report <ArrowUpRight size={14} />
              </Link>
              <button
                type="button"
                onClick={() => discover.mutate()}
                disabled={discover.isPending}
                data-testid="button-discover"
                className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--accent))] px-4 py-2.5 text-[13px] font-semibold text-[hsl(var(--accent-foreground))] transition-transform hover:-translate-y-0.5 disabled:opacity-70"
              >
                {discover.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {discover.isPending ? 'Discovering…' : 'Discover latest'}
              </button>
            </div>
          </div>

          {flash && (
            <div className="mt-4 rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] p-3 text-[13px] text-[hsl(var(--accent))]">
              {flash}
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {TABS.filter((t) => t.key !== 'all').map((t) => {
              const count = query.data?.counts[t.key as SourceType] ?? 0;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  data-testid={`tab-${t.key}`}
                  className={
                    'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ' +
                    (active
                      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/.08)]'
                      : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--secondary))]')
                  }
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
                    {t.label}
                  </span>
                  <span className="font-display text-2xl leading-none text-[hsl(var(--foreground))]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                data-testid={`filter-${t.key}`}
                className={
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ' +
                  (active
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')
                }
              >
                <Icon size={12} /> {t.label}
              </button>
            );
          })}
        </div>

        {query.isLoading && (
          <div className="flex items-center gap-3 py-16 text-[hsl(var(--muted-foreground))]">
            <Loader2 className="animate-spin" size={18} /> Loading intelligence…
          </div>
        )}
        {query.isError && (
          <div className="my-10 flex items-start gap-3 rounded-xl border border-[hsl(0_75%_45%/.35)] bg-[hsl(0_75%_45%/.08)] p-5 text-[hsl(0_75%_35%)]">
            <AlertTriangle size={18} className="mt-0.5" />
            <div>
              <p className="font-semibold">Failed to load intelligence.</p>
              <p className="mt-1 text-sm">{String(query.error)}</p>
            </div>
          </div>
        )}

        {query.data && (
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredItems.length === 0 && (
              <p className="col-span-full text-[14px] text-[hsl(var(--muted-foreground))]">
                No items in this category yet — hit "Discover latest" to refresh.
              </p>
            )}
            {filteredItems.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
