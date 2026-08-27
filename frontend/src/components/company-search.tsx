import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, Link } from 'wouter';
import { Search, ArrowRight, Loader2, Plus, Sparkles } from 'lucide-react';

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ||
  (import.meta.env.REACT_APP_BACKEND_URL as string | undefined) ||
  '';

export interface CompanySearchResult {
  id: string;
  name: string;
  ticker: string;
  exchange: string;
  short_description: string | null;
}

async function searchCompanies(term: string): Promise<CompanySearchResult[]> {
  const qp = term.trim() ? `?search=${encodeURIComponent(term.trim())}` : '';
  const url = `${BACKEND_URL}/api/companies${qp}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return [];
  return (await r.json()) as CompanySearchResult[];
}

async function onboardCompany(payload: { ticker: string; name: string }) {
  const r = await fetch(`${BACKEND_URL}/api/intelligence/onboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  return r.json();
}

/**
 * Live search box.
 * • Query hits GET /api/companies?search=<term> and shows real matches.
 * • Blank → full directory (all onboarded companies).
 * • No match → offer inline "Onboard company" which calls POST /api/intelligence/onboard
 *   and navigates to the intelligence page for the new ticker.
 */
export function CompanySearch() {
  const [, setLocation] = useLocation();
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [directory, setDirectory] = useState<CompanySearchResult[]>([]);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    searchCompanies('').then(setDirectory).catch(() => setDirectory([]));
  }, []);

  useEffect(() => {
    const h = setTimeout(() => setDebouncedTerm(term), 220);
    return () => clearTimeout(h);
  }, [term]);

  useEffect(() => {
    if (!debouncedTerm.trim()) {
      setResults(directory);
      return;
    }
    setLoading(true);
    searchCompanies(debouncedTerm)
      .then((r) => setResults(r))
      .finally(() => setLoading(false));
  }, [debouncedTerm, directory]);

  const suggestions = useMemo(
    () => (results.length > 0 ? results : directory),
    [results, directory],
  );

  const exactHit = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return null;
    return (
      results.find(
        (r) =>
          r.ticker.toLowerCase() === q ||
          r.name.toLowerCase() === q ||
          `${r.name.toLowerCase()} limited` === q,
      ) ?? null
    );
  }, [term, results]);

  const canOnboard =
    term.trim().length >= 2 && results.length === 0 && !loading && !onboardingBusy;

  const submitFirst = () => {
    const target = exactHit ?? results[0] ?? null;
    if (target) {
      setLocation(`/live-report/${target.ticker}`);
      return;
    }
    if (canOnboard) {
      onboard();
    }
  };

  async function onboard() {
    if (!term.trim()) return;
    setOnboardError(null);
    setOnboardingBusy(true);
    try {
      const guessTicker = term.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 24);
      const res = await onboardCompany({
        ticker: guessTicker,
        name: term.trim(),
      });
      const t = res?.company?.ticker ?? guessTicker;
      // Refresh the directory
      const fresh = await searchCompanies('');
      setDirectory(fresh);
      setLocation(`/intelligence/${t}`);
    } catch (err) {
      setOnboardError(String(err));
    } finally {
      setOnboardingBusy(false);
    }
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={containerRef} data-testid="company-search">
      <div className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 pl-4 shadow-[var(--shadow-md)] transition-all focus-within:border-[hsl(var(--primary)/.55)] focus-within:shadow-[0_12px_32px_hsl(var(--primary)/.12)]">
        <Search size={20} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => e.key === 'Enter' && submitFirst()}
          data-testid="input-company-search"
          className="min-w-0 flex-1 bg-transparent py-3 text-[15px] outline-none placeholder:text-[hsl(var(--muted-foreground))]"
          placeholder="Search a company — try Reliance, TCS, Infy, ITC…"
          aria-label="Search a company"
        />
        <button
          type="button"
          onClick={submitFirst}
          data-testid="button-search-company"
          disabled={loading || onboardingBusy}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70"
        >
          {loading || onboardingBusy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <span className="hidden sm:inline">Read research</span>
          )}
          {!loading && !onboardingBusy && <ArrowRight size={16} />}
        </button>
      </div>

      {focused && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-[420px] overflow-y-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-[var(--shadow-md)]"
          data-testid="company-search-dropdown"
        >
          {suggestions.length > 0 && (
            <div className="mb-2 px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
              {term.trim() ? 'Matches' : 'Available companies'}
            </div>
          )}
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setLocation(`/live-report/${c.ticker}`)}
              data-testid={`company-suggestion-${c.ticker}`}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-[hsl(var(--secondary))]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--primary)/.1)] font-semibold text-[hsl(var(--primary))]">
                {c.ticker.slice(0, 2)}
              </span>
              <span className="flex-1">
                <span className="block text-[14px] font-semibold text-[hsl(var(--foreground))]">
                  {c.name}
                </span>
                <span className="text-[11px] font-mono uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {c.ticker} · {c.exchange}
                </span>
              </span>
              <Sparkles size={13} className="mt-3 shrink-0 text-[hsl(var(--accent))]" />
            </button>
          ))}
          {canOnboard && (
            <button
              type="button"
              onClick={onboard}
              disabled={onboardingBusy}
              data-testid="button-onboard-company"
              className="mt-2 flex w-full items-start gap-3 rounded-xl border border-dashed border-[hsl(var(--accent)/.4)] bg-[hsl(var(--accent)/.06)] px-3 py-3 text-left hover:bg-[hsl(var(--accent)/.1)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--accent)/.15)] text-[hsl(var(--accent))]">
                <Plus size={16} />
              </span>
              <span className="flex-1">
                <span className="block text-[14px] font-semibold text-[hsl(var(--foreground))]">
                  Onboard "{term.trim()}"
                </span>
                <span className="text-[12px] text-[hsl(var(--muted-foreground))]">
                  StockLens will auto-discover filings, credit ratings, IR decks and news.
                </span>
              </span>
              {onboardingBusy && <Loader2 size={16} className="animate-spin text-[hsl(var(--accent))]" />}
            </button>
          )}
          {onboardError && (
            <div className="mt-2 rounded-xl border border-[hsl(0_75%_45%/.35)] bg-[hsl(0_75%_45%/.08)] p-3 text-[12px] text-[hsl(0_75%_35%)]">
              Onboarding failed — {onboardError.slice(0, 200)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact directory of onboarded companies for the home page.
 */
export function CompanyDirectory() {
  const [companies, setCompanies] = useState<CompanySearchResult[]>([]);
  useEffect(() => {
    searchCompanies('').then(setCompanies).catch(() => setCompanies([]));
  }, []);
  if (companies.length === 0) return null;
  return (
    <div className="mt-8 flex flex-wrap gap-2" data-testid="company-directory">
      <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
        Coverage
      </span>
      {companies.slice(0, 12).map((c) => (
        <Link
          key={c.id}
          href={`/live-report/${c.ticker}`}
          data-testid={`directory-${c.ticker}`}
          className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-[12px] font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]"
        >
          {c.ticker} <span className="text-[hsl(var(--muted-foreground))]">·</span> {c.name}
        </Link>
      ))}
    </div>
  );
}
