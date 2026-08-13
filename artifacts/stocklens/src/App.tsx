import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  getGetCompanyResearchQueryKey,
  getSearchCompaniesQueryKey,
  useGetCompanyResearch,
  useSearchCompanies,
} from '@workspace/api-client-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const sectionOrder = [
  ['company', 'what-it-does', 'What it does'],
  ['business_model', 'how-it-makes-money', 'How it makes money'],
  ['what_happened', 'business-change', 'What happened'],
  ['earnings', 'earnings-change', 'Why earnings changed'],
  ['cash_flow', 'cash-flow', 'Cash flow quality'],
  ['industry', 'industry', 'Industry context'],
  ['management', 'management', 'Management & delivery'],
  ['stock_move', 'stock-move', 'Why the stock moved'],
  ['what_is_going_well', 'going-well', 'What is going well'],
  ['what_is_going_wrong', 'going-wrong', 'What is going wrong'],
  ['red_flags', 'red-flags', 'Red flags'],
  ['risks', 'risks', 'What could go wrong'],
  ['what_to_watch', 'watch-next', 'What to watch next'],
  ['summary', 'conclusion', 'The company in simple words'],
] as const;

function Wordmark() {
  return (
    <Link href="/" className="sl-wordmark" data-testid="link-stocklens-home">
      stock<span>lens</span>
    </Link>
  );
}

function Home() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const searchResults = useSearchCompanies(
    { search: submittedQuery || ' ' },
    {
      query: {
        enabled: Boolean(submittedQuery),
        retry: false,
        queryKey: getSearchCompaniesQueryKey({ search: submittedQuery || ' ' }),
      },
    },
  );

  useEffect(() => {
    const firstMatch = searchResults.data?.[0];
    if (firstMatch) {
      setLocation(`/research/${firstMatch.ticker.toLowerCase()}`);
    }
  }, [searchResults.data, setLocation]);

  const search = (value: string) => {
    const cleaned = value.trim();
    setQuery(cleaned);
    setSubmittedQuery(cleaned);
  };

  const hasNoResults =
    Boolean(submittedQuery) &&
    searchResults.isSuccess &&
    !searchResults.isLoading &&
    searchResults.data?.length === 0;

  return (
    <main className="sl-shell sl-home">
      <div className="sl-container">
        <header className="sl-home-header sl-fade-in">
          <Wordmark />
          <span className="sl-kicker">Plain-English equity research</span>
        </header>
        <div className="sl-home-main">
          <section className="sl-fade-in">
            <div className="sl-kicker">For the curious investor</div>
            <h1 className="sl-home-title sl-serif">Understand a company before you invest.</h1>
            <p className="sl-home-subtitle">
              Search a stock and understand what happened, why it happened, and what investors should worry about.
            </p>
            <div className="sl-search-wrap">
              <form
                className="sl-search-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  search(query);
                }}
              >
                <input
                  data-testid="input-company-search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSubmittedQuery('');
                  }}
                  placeholder="Search company name or stock symbol"
                  aria-label="Search company name or stock symbol"
                />
                <button className="sl-search-submit" type="submit" data-testid="button-submit-search">
                  {searchResults.isFetching ? 'Searching…' : 'Read the research'}
                </button>
              </form>
              <div className="sl-example">
                Try:{' '}
                <button
                  type="button"
                  data-testid="button-example-reliance"
                  onClick={() => search('Reliance Industries')}
                >
                  Reliance Industries
                </button>
              </div>
              {searchResults.isError && (
                <div className="sl-error-search sl-fade-in" data-testid="status-database-error">
                  The research library is not connected yet. Run the Supabase schema in <code>artifacts/api-server/supabase/schema.sql</code> and try again.
                </div>
              )}
              {hasNoResults && (
                <div className="sl-error-search sl-fade-in" data-testid="status-no-results">
                  We do not have a finished note for “{submittedQuery}” yet. Try the example above — it opens our Reliance research note.
                </div>
              )}
            </div>
          </section>
          <aside className="sl-home-aside sl-fade-in-delay">
            <div className="sl-kicker">A different kind of stock page</div>
            <strong>Less ticker noise. More “now I get it”.</strong>
            <p>
              StockLens turns reports, results and management commentary into a short, readable explanation. This prototype uses sample data, not live prices or advice.
            </p>
          </aside>
        </div>
        <footer className="sl-home-footer">
          <span>Sample analysis · built for learning</span>
          <span>Not investment advice</span>
        </footer>
      </div>
    </main>
  );
}

function ResearchSection({
  id,
  number,
  title,
  content,
  className = '',
}: {
  id: string;
  number: string;
  title: string;
  content: string;
  className?: string;
}) {
  const blocks = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <section id={id} className={`sl-section ${className}`} data-testid={`section-${id}`}>
      <div className="sl-section-number">{number}</div>
      <h2 className="sl-serif">{title}</h2>
      {blocks.map((block, index) => (
        <p
          className={index === 0 ? 'sl-section-lede' : 'sl-body-copy'}
          key={`${id}-${index}`}
          style={{ whiteSpace: 'pre-line' }}
        >
          {block}
        </p>
      ))}
    </section>
  );
}

function ResearchPage() {
  const researchQuery = useGetCompanyResearch('RELIANCE', {
    query: {
      retry: false,
      queryKey: getGetCompanyResearchQueryKey('RELIANCE'),
    },
  });
  const result = researchQuery.data;
  const researchBySection = useMemo(
    () => new Map(result?.research.map((section) => [section.section, section]) ?? []),
    [result?.research],
  );

  if (researchQuery.isLoading) {
    return (
      <main className="sl-shell">
        <div className="sl-container sl-state-page">
          <Wordmark />
          <p className="sl-kicker">Loading the research library</p>
          <h1 className="sl-serif">Finding the company story…</h1>
        </div>
      </main>
    );
  }

  if (researchQuery.isError || !result) {
    return (
      <main className="sl-shell">
        <div className="sl-container sl-state-page">
          <Wordmark />
          <p className="sl-kicker">Research unavailable</p>
          <h1 className="sl-serif">The company note could not be loaded.</h1>
          <p className="sl-body-copy">
            Connect Supabase and run the schema in <code>artifacts/api-server/supabase/schema.sql</code> to load the demo Reliance content.
          </p>
          <Link href="/" className="sl-return">Back to search</Link>
        </div>
      </main>
    );
  }

  const { company } = result;

  return (
    <main className="sl-shell">
      <header className="sl-research-header">
        <div className="sl-container sl-research-nav">
          <Link href="/" className="sl-back" data-testid="link-back-to-search">← Back to search</Link>
          <div className="sl-research-meta">
            <span className="sl-wordmark">stock<span>lens</span></span>
            <span className="ticker">{company.exchange}: {company.ticker}</span>
          </div>
        </div>
      </header>

      <div className="sl-container">
        <header className="sl-article-head sl-fade-in">
          <div className="sl-kicker">Company research · database note</div>
          <h1 className="sl-serif">{company.name}</h1>
          <p className="sl-dek">Everything you need to understand the company — without reading 200 pages of filings first.</p>
          <div className="sl-update-note">
            SAMPLE ANALYSIS · {company.exchange}: {company.ticker} · DEMO DATA ONLY · NOT LIVE ADVICE
          </div>
        </header>

        <div className="sl-layout">
          <nav className="sl-sticky-nav" aria-label="Research sections" data-testid="research-section-navigation">
            <p>On this page</p>
            {sectionOrder.map(([section, id, label], index) => (
              <a href={`#${id}`} key={section} data-testid={`link-section-${id}`}>
                {String(index + 1).padStart(2, '0')} {label}
              </a>
            ))}
          </nav>

          <article>
            {sectionOrder.map(([section, id], index) => {
              const row = researchBySection.get(section);
              if (!row) return null;
              return (
                <ResearchSection
                  key={row.id}
                  id={id}
                  number={String(index + 1).padStart(2, '0')}
                  title={row.title}
                  content={row.content}
                  className={section === 'summary' ? 'sl-conclusion' : ''}
                />
              );
            })}
          </article>
        </div>
      </div>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/research/:ticker" component={ResearchPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;