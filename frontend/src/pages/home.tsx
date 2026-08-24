import { ArrowRight, BarChart3, FileText, Newspaper, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { Footer, Header } from '@/components/stocklens-ui';
import { CompanySearch, CompanyDirectory } from '@/components/company-search';

const sampleCards = [
  { label: 'Business map', value: '5 engines', detail: 'See where money comes from', icon: <BarChart3 size={17} /> },
  { label: 'Financial story', value: '8 signals', detail: 'Read the why, not just the what', icon: <FileText size={17} /> },
  { label: 'Investor lens', value: '5 checks', detail: 'Spot relationships worth watching', icon: <ShieldCheck size={17} /> },
];

export default function Home() {
  return (
    <div className="min-h-[100dvh] overflow-hidden">
      <Header />
      <main>
        <section className="relative mx-auto max-w-[1380px] px-5 pb-20 pt-16 lg:px-10 lg:pb-28 lg:pt-24">
          <div className="pointer-events-none absolute -right-40 top-[-80px] h-[520px] w-[520px] rounded-full bg-[hsl(var(--primary)/.09)] blur-3xl" />
          <div className="pointer-events-none absolute left-[-160px] top-[380px] h-[340px] w-[340px] rounded-full bg-[hsl(var(--accent)/.06)] blur-3xl" />
          <div className="grid items-center gap-16 lg:grid-cols-[1.02fr_.98fr] lg:gap-24">
            <div className="relative z-10 max-w-2xl">
              <div className="reveal inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.06)] px-3 py-2 font-mono-stock text-[10px] uppercase tracking-[.12em] text-[hsl(var(--primary))]">
                <Sparkles size={13} /> Automated multi-agent research
              </div>
              <h1 className="reveal reveal-delay-1 mt-7 font-display text-[clamp(52px,7.5vw,98px)] leading-[.91] tracking-[-.065em] text-[hsl(var(--foreground))]">Understand any company <span className="text-[hsl(var(--primary))]">before you invest.</span></h1>
              <p className="reveal reveal-delay-2 mt-7 max-w-lg text-[17px] leading-[1.65] text-[hsl(var(--muted-foreground))]">Seven specialist agents read the annual report, filings, concalls, credit ratings and material news, then hand you a professional Initiating-Coverage report — grounded in evidence, no jargon.</p>
              <div className="reveal reveal-delay-3 mt-9 max-w-xl">
                <CompanySearch />
                <p className="mt-3 flex items-center gap-2 pl-1 text-xs text-[hsl(var(--muted-foreground))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />Type any Indian ticker — if it's not covered yet, StockLens will onboard it and pull sources automatically.</p>
                <CompanyDirectory />
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-[510px] lg:mt-4">
              <div className="absolute -inset-5 rounded-[35px] border border-[hsl(var(--primary)/.08)] rotate-3" />
              <div className="relative overflow-hidden rounded-[25px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[var(--shadow-md)]">
                <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
                  <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[hsl(var(--primary))] text-xs font-bold text-[hsl(var(--primary-foreground))]">R</span><div><p className="text-sm font-semibold">Reliance Industries</p><p className="font-mono-stock text-[9px] uppercase text-[hsl(var(--muted-foreground))]">7 specialists · QA · 30 sections</p></div></div>
                  <span className="rounded-full bg-[hsl(var(--primary)/.1)] px-2.5 py-1 font-mono-stock text-[9px] text-[hsl(var(--primary))]">LIVE</span>
                </div>
                <div className="p-5">
                  <div className="flex items-end justify-between"><div><p className="eyebrow">Consolidated revenue FY25-26</p><p className="mt-2 font-display text-4xl tracking-[-.05em]">₹11.76L cr</p></div><div className="text-right"><p className="font-mono-stock text-xs text-[hsl(var(--primary))]">+9.8% YoY</p><p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">from annual report</p></div></div>
                  <div className="mt-5 h-[122px] rounded-xl bg-[hsl(var(--secondary)/.6)] p-3">
                    <svg viewBox="0 0 430 100" preserveAspectRatio="none" className="h-full w-full"><path d="M0 84 C40 76, 54 89, 84 72 S123 63, 152 68 S194 54, 220 59 S250 47, 278 52 S318 34, 344 41 S380 25, 430 13" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" /><path d="M0 84 C40 76, 54 89, 84 72 S123 63, 152 68 S194 54, 220 59 S250 47, 278 52 S318 34, 344 41 S380 25, 430 13 L430 100 L0 100 Z" fill="hsl(var(--primary)/.08)" /></svg>
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[hsl(var(--border))] pt-4">{[['O2C', '54%'], ['Digital', '22%'], ['Retail', '16%']].map(([a, b]) => <div key={a}><p className="font-mono-stock text-[10px] text-[hsl(var(--muted-foreground))]">{a}</p><p className="mt-1 text-lg font-semibold">{b}</p></div>)}</div>
                </div>
                <div className="flex items-center justify-between border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.42)] px-5 py-3"><span className="font-mono-stock text-[9px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Business · cash · risk · governance · outlook</span><ArrowRight size={15} className="text-[hsl(var(--primary))]" /></div>
              </div>
              <div className="absolute -bottom-7 -left-7 hidden w-44 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-md)] sm:block"><p className="eyebrow">Fresh sources</p><p className="mt-2 font-display text-xl">Auto-refreshed</p><div className="mt-3 flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><Newspaper size={12} /> News · Filings · Ratings</div></div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.37)]">
          <div className="mx-auto max-w-[1380px] px-5 py-16 lg:px-10 lg:py-20">
            <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr]">
              <div><p className="eyebrow text-[hsl(var(--accent))]">A research desk, not a terminal</p><h2 className="mt-4 max-w-sm font-display text-4xl leading-[1] tracking-[-.045em] md:text-5xl">The whole business, in one honest read.</h2></div>
              <div className="grid gap-3 sm:grid-cols-3">{sampleCards.map((card, index) => <div key={card.label} className={`paper-card rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-1 ${index === 1 ? 'sm:mt-7' : ''}`} data-testid={`card-research-feature-${index}`}><div className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">{card.icon}</div><p className="mt-7 font-mono-stock text-[10px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{card.label}</p><p className="mt-2 font-display text-2xl">{card.value}</p><p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{card.detail}</p></div>)}</div>
            </div>
          </div>
        </section>

        <section id="method" className="mx-auto max-w-[1380px] px-5 py-20 lg:px-10 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]">
            <div><p className="eyebrow text-[hsl(var(--primary))]">Our method</p><h2 className="mt-4 max-w-md font-display text-5xl leading-[.98] tracking-[-.05em]">A little more context. A lot less noise.</h2><p className="mt-5 max-w-sm text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Every report separates what the numbers say from what we think they might mean.</p></div>
            <div className="grid gap-0 border-t border-[hsl(var(--border))]">{[['01', 'Facts first', 'Start with the business, the financial statements and the plain-English definitions.'], ['02', 'Connections next', 'Cross-check revenue, cash, debt, inventory and promises so the story has to hang together.'], ['03', 'Questions last', 'End with the questions an everyday investor can take into the next result or annual meeting.']].map(([number, title, body]) => <div key={number} className="grid grid-cols-[52px_1fr] gap-5 border-b border-[hsl(var(--border))] py-6"><span className="font-mono-stock text-xs text-[hsl(var(--accent))]">{number}</span><div><h3 className="font-display text-2xl">{title}</h3><p className="mt-2 max-w-lg text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{body}</p></div></div>)}</div>
          </div>
        </section>

        <section className="mx-auto max-w-[1380px] px-5 pb-20 lg:px-10 lg:pb-28">
          <div className="relative overflow-hidden rounded-[26px] bg-[hsl(var(--primary))] px-6 py-10 text-[hsl(var(--primary-foreground))] md:px-12 md:py-14">
            <div className="absolute right-[-40px] top-[-100px] h-[300px] w-[300px] rounded-full border-[32px] border-[hsl(var(--primary-foreground)/.07)]" />
            <div className="relative max-w-2xl"><p className="eyebrow text-[hsl(var(--primary-foreground)/.62)]">Start with a real example</p><h2 className="mt-4 font-display text-4xl leading-[.98] tracking-[-.04em] md:text-6xl">What actually drives Reliance?</h2><p className="mt-5 max-w-lg text-sm leading-relaxed text-[hsl(var(--primary-foreground)/.72)]">Open the live 30-section Initiating Coverage report — with programmatic calculations, evidence tags and auto-discovered filings and news alongside it.</p><div className="mt-8 flex flex-wrap items-center gap-3"><Link href="/live-report/RELIANCE" data-testid="link-try-reliance" className="inline-flex items-center gap-3 rounded-xl bg-[hsl(var(--accent))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--accent-foreground))] transition-transform hover:-translate-y-0.5">Open Reliance research <ArrowRight size={16} /></Link><Link href="/intelligence/RELIANCE" data-testid="link-reliance-intelligence" className="inline-flex items-center gap-3 rounded-xl border border-[hsl(var(--primary-foreground)/.35)] bg-[hsl(var(--primary-foreground)/.08)] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary-foreground)/.14)]">Live company intelligence <ArrowRight size={16} /></Link></div></div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}