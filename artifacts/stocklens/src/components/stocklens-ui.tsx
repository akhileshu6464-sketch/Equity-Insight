import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowRight,
  ChevronDown,
  CircleHelp,
  Menu,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { company, sections } from '@/data/reliance';

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" data-testid="link-stocklens-home" className="flex items-center gap-2.5 group">
      <span className="relative grid h-9 w-9 place-items-center rounded-[11px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_5px_13px_hsl(var(--primary)/.2)]">
        <span className="absolute left-[9px] top-[9px] h-3.5 w-3.5 rounded-full border-2 border-current" />
        <span className="absolute bottom-[7px] right-[7px] h-[2px] w-3.5 rotate-45 bg-current" />
      </span>
      {!compact && <span className="font-display text-[23px] tracking-[-.04em] text-[hsl(var(--foreground))]">StockLens</span>}
    </Link>
  );
}

export function Header({ report = false }: { report?: boolean }) {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  return (
    <header className="relative z-40 border-b border-[hsl(var(--border)/.75)] bg-[hsl(var(--background)/.92)] backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-[1380px] items-center justify-between px-5 lg:px-10">
        <Wordmark />
        {report ? (
          <div className="hidden items-center gap-3 md:flex">
            <span className="eyebrow">SAMPLE RESEARCH DESK</span>
            <span className="h-4 w-px bg-[hsl(var(--border))]" />
            <span className="font-mono-stock text-[11px] text-[hsl(var(--muted-foreground))]">Updated {company.lastUpdated}</span>
          </div>
        ) : (
          <nav className="hidden items-center gap-7 md:flex">
            <a href="#how-it-works" data-testid="link-how-it-works" className="text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]">How it works</a>
            <a href="#method" data-testid="link-method" className="text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]">Our method</a>
            <Link href="/research/reliance-industries" data-testid="link-sample-report" className="flex items-center gap-1.5 text-sm font-semibold text-[hsl(var(--primary))]">View sample report <ArrowRight size={15} /></Link>
          </nav>
        )}
        <button type="button" onClick={() => setOpen(!open)} data-testid="button-open-menu" className="grid h-9 w-9 place-items-center rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] md:hidden">
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-[68px] border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-md)] md:hidden">
          <div className="grid gap-4 text-sm">
            <a href="#how-it-works" onClick={() => setOpen(false)} data-testid="mobile-link-how-it-works">How it works</a>
            <a href="#method" onClick={() => setOpen(false)} data-testid="mobile-link-method">Our method</a>
            <button type="button" onClick={() => { setLocation('/research/reliance-industries'); setOpen(false); }} data-testid="mobile-button-sample-report" className="flex items-center justify-between text-left font-semibold text-[hsl(var(--primary))]">View sample report <ArrowRight size={15} /></button>
          </div>
        </div>
      )}
    </header>
  );
}

export function SearchBox({ onUnsupported }: { onUnsupported?: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const [, setLocation] = useLocation();
  const go = () => {
    const normalized = query.trim().toLowerCase();
    if (normalized === 'reliance' || normalized === 'reliance industries' || normalized === 'reliance industries limited') {
      setLocation('/research/reliance-industries');
    } else if (query.trim()) {
      onUnsupported?.(query.trim());
    }
  };
  return (
    <div className="relative">
      <div className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 pl-4 shadow-[var(--shadow-md)] transition-all focus-within:border-[hsl(var(--primary)/.55)] focus-within:shadow-[0_12px_32px_hsl(var(--primary)/.12)]">
        <Search size={20} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} data-testid="input-company-search" className="min-w-0 flex-1 bg-transparent py-3 text-[15px] outline-none placeholder:text-[hsl(var(--muted-foreground))]" placeholder="Search a company — try Reliance" aria-label="Search a company" />
        <button type="button" onClick={go} data-testid="button-search-company" className="flex shrink-0 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 active:translate-y-0">
          <span className="hidden sm:inline">Read research</span><ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function DataTag({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'fact' | 'analysis' | 'inference' | 'uncertainty' }) {
  const colors = {
    neutral: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
    fact: 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]',
    analysis: 'bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]',
    inference: 'bg-[hsl(var(--chart-3)/.14)] text-[hsl(35_62%_32%)]',
    uncertainty: 'bg-[hsl(var(--chart-4)/.12)] text-[hsl(var(--chart-4))]',
  };
  return <span className={`inline-flex rounded-full px-2 py-1 font-mono-stock text-[9px] font-medium uppercase tracking-[.09em] ${colors[tone]}`} data-testid={`tag-${tone}`}>{children}</span>;
}

export function SignalPill({ signal }: { signal: 'LOW' | 'WATCH' | 'HIGH' }) {
  const styles = {
    LOW: 'border-[hsl(var(--primary)/.22)] bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))]',
    WATCH: 'border-[hsl(var(--accent)/.3)] bg-[hsl(var(--accent)/.1)] text-[hsl(var(--accent))]',
    HIGH: 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]',
  };
  return <span data-testid={`signal-${signal.toLowerCase()}`} className={`rounded-full border px-2.5 py-1 font-mono-stock text-[9px] font-medium tracking-[.1em] ${styles[signal]}`}>{signal}</span>;
}

export function SectionHeading({ eyebrow, title, children, id }: { eyebrow: string; title: string; children?: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="section-anchor mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <div className="eyebrow mb-3 text-[hsl(var(--primary))]">{eyebrow}</div>
        <h2 className="font-display text-[clamp(29px,4vw,44px)] leading-[.98] tracking-[-.04em] text-[hsl(var(--foreground))]" data-testid={`heading-${id ?? eyebrow.toLowerCase().replaceAll(' ', '-')}`}>{title}</h2>
      </div>
      {children && <div className="max-w-sm text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{children}</div>}
    </div>
  );
}

export function SourceNote({ children = 'Sample data · illustrative only' }: { children?: string }) {
  return <p className="mt-4 flex items-center gap-2 font-mono-stock text-[10px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]" data-testid="text-source-note"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />{children}</p>;
}

export function Expandable({ title, children, defaultOpen = false, testId }: { title: string; children: ReactNode; defaultOpen?: boolean; testId: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[hsl(var(--border))] last:border-b-0">
      <button type="button" onClick={() => setOpen(!open)} data-testid={`button-expand-${testId}`} className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold text-[hsl(var(--foreground))]">
        {title}<ChevronDown size={17} className={`shrink-0 text-[hsl(var(--muted-foreground))] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-5 pr-8 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]" data-testid={`content-expand-${testId}`}>{children}</div>}
    </div>
  );
}

export function MiniChart({ values, color = 'hsl(var(--primary))' }: { values: number[]; color?: string }) {
  const points = values.map((value, i) => `${(i / (values.length - 1)) * 100},${40 - (value / 100) * 34}`).join(' ');
  return (
    <svg viewBox="0 0 100 42" preserveAspectRatio="none" className="h-12 w-full overflow-visible" aria-hidden="true">
      <path d="M0 40 H100" stroke="hsl(var(--border))" strokeWidth=".5" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" className="chart-line" />
    </svg>
  );
}

export function ReportRail() {
  const [active, setActive] = useState('overview');
  return (
    <nav className="sticky top-[68px] z-30 overflow-x-auto border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.94)] backdrop-blur-md" data-testid="nav-report-sections">
      <div className="mx-auto flex max-w-[1380px] gap-0 px-5 lg:px-10">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`} onClick={() => setActive(section.id)} data-testid={`link-section-${section.id}`} className={`relative whitespace-nowrap px-3 py-4 font-mono-stock text-[10px] uppercase tracking-[.06em] transition-colors first:pl-0 md:px-4 ${active === section.id ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}>
            {section.label}
            {active === section.id && <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-[hsl(var(--accent))] first:left-0" />}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.4)]">
      <div className="mx-auto flex max-w-[1380px] flex-col gap-7 px-5 py-10 md:flex-row md:items-end md:justify-between lg:px-10">
        <div><Wordmark /><p className="mt-3 max-w-xs text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Research for the curious investor. Plain English, careful context, no certainty theatre.</p></div>
        <div className="text-left md:text-right"><p className="eyebrow">PROTOTYPE / SAMPLE DATA ONLY</p><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Not investment advice. No live market data.</p></div>
      </div>
    </footer>
  );
}

export function StatusIcon({ status }: { status: string }) {
  if (status === 'On track') return <span className="text-[hsl(var(--primary))]"><TrendingUp size={16} /></span>;
  if (status === 'Partially achieved') return <span className="text-[hsl(var(--accent))]"><CircleHelp size={16} /></span>;
  return <span className="text-[hsl(var(--chart-4))]"><Sparkles size={16} /></span>;
}

export function EmptySampleState({ query }: { query: string }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-[hsl(var(--accent)/.28)] bg-[hsl(var(--accent)/.06)] p-4 text-left" data-testid="status-search-sample-only">
      <CircleHelp size={18} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" />
      <div><p className="text-sm font-semibold">No sample report for “{query}” yet.</p><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">StockLens is a sample-only prototype, so the library currently includes Reliance Industries. Try searching “Reliance” to open the report.</p></div>
    </div>
  );
}

export function IconLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="flex items-center gap-2 text-sm font-semibold">{icon}{children}</div>;
}