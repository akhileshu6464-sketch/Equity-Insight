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
import { Link, Route, Switch, useLocation, Router as WouterRouter, useParams } from 'wouter';
import { Search, ArrowLeft, TrendingUp, AlertTriangle, Info, BookOpen, AlertCircle } from 'lucide-react';

const queryClient = new QueryClient();

// Keep audit metadata in the API/database, but present only the investor-facing
// prose in the normal report. Source details are not currently exposed as a
// separate user interaction, so they remain intentionally out of the UI.
const isAuditMetadataLine = (line: string) =>
  /^\s*\[(?:Fact|Inference|Uncertain)\b.*\]\s*$/i.test(line) ||
  /^\s*\[[^\]]*(?:confidence|Annual Report|chunks?\b|pages?\b|source|evidence)[^\]]*\]\s*$/i.test(line);

const cleanInvestorContent = (text?: string) =>
  (text || '')
    .split(/\r?\n/)
    .filter((line) => !isAuditMetadataLine(line))
    .join('\n');

const getBlocks = (text?: string) => {
  return cleanInvestorContent(text)
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(b => b && !b.startsWith('DEMO CONTENT:'));
};

const DEEPER_GROUPS = [
  { id: 'business', label: 'Business', sections: ['company'] },
  { id: 'what_changed', label: 'What Changed', sections: ['what_happened'] },
  { id: 'segments', label: 'Segment Analysis', sections: ['segments'] },
  { id: 'financials', label: 'Financial Statements', sections: ['financial_statements'] },
  { id: 'financial_trends', label: 'Five-Year Financial Trends', sections: ['financial_trends'] },
  { id: 'ratios', label: 'Financial Ratios', sections: ['ratios'] },
  { id: 'cash_flow', label: 'Cash Flow', sections: ['cash_flow'] },
  { id: 'balance_sheet', label: 'Balance Sheet', sections: ['balance_sheet'] },
  { id: 'receivables', label: 'Receivables', sections: ['receivables'] },
  { id: 'inventory', label: 'Inventory', sections: ['inventory'] },
  { id: 'payables', label: 'Payables', sections: ['payables'] },
  { id: 'working_capital', label: 'Working Capital', sections: ['working_capital'] },
  { id: 'debt', label: 'Debt & Liquidity', sections: ['debt'] },
  { id: 'industry', label: 'Industry', sections: ['industry'] },
  { id: 'management', label: 'Management', sections: ['management'] },
  { id: 'outlook', label: 'Outlook & Guidance', sections: ['outlook'] },
  { id: 'risks', label: 'Risks & Red Flags', sections: ['what_is_going_wrong'] },
  { id: 'positives', label: 'Positive Developments', sections: ['what_is_going_well'] },
  { id: 'takeaway', label: 'Investor Takeaway', sections: ['summary'] },
  { id: 'shareholders', label: 'Shareholders', sections: ['shareholders'] },
  { id: 'governance', label: 'Governance & Auditor', sections: ['governance'] },
  { id: 'related_parties', label: 'Related-Party Transactions', sections: ['related_parties'] },
  { id: 'subsidiaries', label: 'Subsidiaries / JVs', sections: ['subsidiaries'] }
] as const;

function Wordmark() {
  return (
    <Link href="/" className="font-serif text-2xl tracking-tight text-foreground flex items-center gap-1 group" data-testid="link-stocklens-home">
      Stock<span className="text-primary italic">Lens</span>
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
    if (!cleaned) return;
    setQuery(cleaned);
    setSubmittedQuery(cleaned);
  };

  const hasNoResults =
    Boolean(submittedQuery) &&
    searchResults.isSuccess &&
    !searchResults.isLoading &&
    searchResults.data?.length === 0;

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-secondary rounded-full blur-3xl translate-y-1/3 -translate-x-1/3 pointer-events-none" />

      <div className="w-full max-w-2xl relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="mb-12 flex justify-center">
          <Wordmark />
        </div>
        
        <div className="text-center mb-10">
          <h1 className="font-serif text-5xl md:text-6xl text-foreground mb-6 leading-[1.1] tracking-tight">
            Research any stock in minutes.
          </h1>
          <p className="font-sans text-lg text-foreground/70 max-w-xl mx-auto">
            Stop reading hundreds of pages and searching across multiple websites. Search a company and get the important information, developments, risks and investor insights in one place.
          </p>
        </div>

        <div className="bg-card border border-border p-2 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(query);
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-1"
          >
            <div className="flex-1 min-w-0 flex items-center px-3 sm:px-4 min-h-[48px]">
              <Search className="w-5 h-5 text-muted-foreground mr-3 shrink-0" />
              <input
                data-testid="input-company-search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSubmittedQuery('');
                }}
                className="w-full min-w-0 bg-transparent border-none outline-none text-base sm:text-lg text-foreground placeholder:text-muted-foreground h-12"
                placeholder="Search company name or ticker"
                aria-label="Search company name or ticker"
              />
            </div>
            <button
              type="submit"
              data-testid="button-submit-search"
              className="btn-primary bg-primary text-primary-foreground px-8 py-3 rounded-lg font-medium text-sm tracking-wide h-12 flex items-center justify-center sm:min-w-[160px] w-full sm:w-auto"
              disabled={searchResults.isFetching}
            >
              {searchResults.isFetching ? (
                <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                'SEARCH COMPANY'
              )}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center text-sm editorial-mono text-muted-foreground">
          Try:{' '}
          <button
            type="button"
            data-testid="button-example-reliance"
            onClick={() => {
              setQuery('Reliance Industries');
              search('Reliance Industries');
            }}
            className="text-primary hover:text-primary/80 transition-colors border-b border-primary/30 hover:border-primary pb-0.5 ml-1"
          >
            Reliance Industries
          </button>
        </div>

        {searchResults.isError && (
          <div className="mt-8 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm text-center" data-testid="status-database-error">
            The research library is not connected yet. Run the Supabase schema in <code>artifacts/api-server/supabase/schema.sql</code> and try again.
          </div>
        )}
        {hasNoResults && (
          <div className="mt-8 p-4 bg-secondary border border-border rounded-lg text-foreground/80 text-sm text-center" data-testid="status-no-results">
            We do not have a finished note for <span className="font-semibold">"{submittedQuery}"</span> yet. Try the example above.
          </div>
        )}
      </div>
    </main>
  );
}

function SectionContent({ content, isLead = false }: { content: string; isLead?: boolean }) {
  const blocks = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        const isBullet = block.startsWith('-') || block.startsWith('•');
        return (
          <p
            key={index}
            className={`
              ${isLead && index === 0 ? 'editorial-lead' : 'editorial-body'}
              ${isBullet ? 'pl-4 border-l-2 border-primary/20' : ''}
            `}
            style={{ whiteSpace: 'pre-line' }}
          >
            {block}
          </p>
        );
      })}
    </div>
  );
}

function ResearchPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = params?.ticker?.toUpperCase() || '';
  
  const researchQuery = useGetCompanyResearch(ticker, {
    query: {
      retry: false,
      queryKey: getGetCompanyResearchQueryKey(ticker),
    },
  });

  const result = researchQuery.data;
  
  const sectionsMap = useMemo(
    () => new Map(result?.research.map((section) => [section.section, section]) ?? []),
    [result?.research]
  );

  // Parse Quick View from existing sections according to strict rules
  const quickViewItems = useMemo(() => {
    const items = [];
    
    const whatHappenedBlocks = getBlocks(sectionsMap.get('what_happened')?.content);
    let whatIsHappening = '';
    let whyItMatters = '';
    
    whatHappenedBlocks.forEach(block => {
      if (/^WHY (?:DOES IT MATTER\?|IT MATTERS)\b/i.test(block)) {
        whyItMatters = block.replace(/^WHY (?:DOES IT MATTER\?|IT MATTERS)\s*/i, '').trim();
      } else if (!whatIsHappening) {
        whatIsHappening = block;
      }
    });
    
    if (whatIsHappening) {
      items.push({ id: 'what_happening', label: 'What’s happening', content: whatIsHappening, icon: Info, span: 'md:col-span-2 lg:col-span-2' });
    }
    if (whyItMatters) {
      items.push({ id: 'why_it_matters', label: 'Why it matters', content: whyItMatters, icon: TrendingUp, span: 'md:col-span-1 lg:col-span-1' });
    }
    
    const posBlock = getBlocks(sectionsMap.get('what_is_going_well')?.content)[0];
    if (posBlock) {
      items.push({ id: 'biggest_positive', label: 'Biggest positive', content: posBlock, icon: TrendingUp, span: 'md:col-span-1 lg:col-span-1' });
    }
    
    const negBlock = getBlocks(sectionsMap.get('what_is_going_wrong')?.content)[0];
    if (negBlock) {
      items.push({ id: 'biggest_concern', label: 'Biggest concern', content: negBlock, icon: AlertTriangle, span: 'md:col-span-1 lg:col-span-1' });
    }
    
    const watchBlocks = getBlocks(sectionsMap.get('what_to_watch')?.content);
    if (watchBlocks.length > 0) {
      items.push({ id: 'what_to_watch', label: 'What to watch', content: watchBlocks.join('\n\n'), icon: BookOpen, span: 'md:col-span-1 lg:col-span-1' });
    }
    
    const takeawayBlocks = getBlocks(sectionsMap.get('summary')?.content);
    if (takeawayBlocks.length > 0) {
      items.push({ id: 'takeaway', label: 'Investor takeaway', content: takeawayBlocks.join('\n\n'), icon: Info, span: 'md:col-span-2 lg:col-span-3', isSummary: true });
    }
    
    return items;
  }, [sectionsMap]);

  // Map only sections backed by existing research content. Accounting basis
  // stays attached to the specific prose that states it; never infer a basis
  // for an entire grouped section.
  const deeperGroups = useMemo(() => {
    return DEEPER_GROUPS.map(group => {
      const matchingSections = group.sections
        .map(secId => sectionsMap.get(secId))
        .filter(Boolean);
      
      if (matchingSections.length === 0) return null;
      
      const fullContent = matchingSections.map(s => getBlocks(s!.content).join('\n\n')).join('\n\n');
      if (!fullContent) return null;

      return {
        id: group.id,
        label: group.label,
        content: fullContent
      };
    }).filter(Boolean) as { id: string; label: string; content: string }[];
  }, [sectionsMap]);

  if (researchQuery.isLoading) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="text-center animate-pulse">
          <Wordmark />
          <p className="mt-8 font-serif text-2xl text-foreground/60">Fetching research...</p>
        </div>
      </main>
    );
  }

  if (researchQuery.isError || !result) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-6" />
          <h1 className="font-serif text-3xl text-foreground mb-4">Research unavailable</h1>
          <p className="text-foreground/70 mb-8">
            The company note could not be loaded. Ensure the database is connected and populated.
          </p>
          <Link href="/" className="btn-primary inline-flex items-center gap-2 bg-foreground text-background px-6 py-2.5 rounded-lg text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to search
          </Link>
        </div>
      </main>
    );
  }

  const { company } = result;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-foreground/60 hover:text-foreground transition-colors flex items-center gap-2 text-sm font-medium" data-testid="link-back-to-search">
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
            <div className="w-px h-4 bg-border hidden sm:block" />
            <div className="hidden sm:block">
              <Wordmark />
            </div>
          </div>
          <div className="editorial-mono text-xs text-foreground/60 flex items-center gap-3">
            <span>{company.exchange}:{company.ticker}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-primary/40"></span>
            <span>Sample Data</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 md:py-20 animate-article-in">
        
        {/* Company Identity */}
        <header className="mb-20 max-w-4xl">
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-bold tracking-widest uppercase rounded-full">
              {company.sector}
            </span>
            <span className="editorial-mono text-foreground/50">{company.industry}</span>
          </div>
          
          <h1 className="font-serif text-5xl md:text-7xl leading-[1.05] tracking-tight mb-6" data-testid="text-company-name">
            {company.name}
          </h1>
          
          <p className="text-xl md:text-2xl text-foreground/70 max-w-3xl leading-relaxed mb-8">
            Here is what you need to know about {company.name}.
          </p>
          
          <div className="text-sm text-foreground/40 font-mono">
            Last updated: {company.updated_at ? new Date(company.updated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown'}
          </div>
        </header>

        {/* Quick View - The Executive Summary */}
        {quickViewItems.length > 0 && (
          <section className="mb-24">
            <div className="flex items-center gap-4 mb-8">
              <h2 className="editorial-mono text-primary text-sm font-bold border-b border-primary pb-1">Quick View</h2>
              <div className="flex-1 h-px bg-border"></div>
            </div>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {quickViewItems.map((item) => {
                const Icon = item.icon;
                const isSummary = item.isSummary;
                
                return (
                  <div 
                    key={item.id}
                    data-testid={`quick-view-card-${item.id}`}
                    className={`bg-card border border-border p-6 rounded-xl flex flex-col ${item.span} ${isSummary ? 'bg-foreground text-background border-transparent' : ''}`}
                  >
                    <div className="flex items-center gap-3 mb-4">
                      {!isSummary && (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                      )}
                      <h3 className={`font-serif text-xl ${isSummary ? 'text-background' : 'text-foreground'}`}>
                        {item.label}
                      </h3>
                    </div>
                    <div className={`flex-1 font-sans leading-relaxed ${isSummary ? 'text-lg text-background/90' : 'text-base text-foreground/80'}`}>
                      <p style={{ whiteSpace: 'pre-line' }}>{item.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Deeper Research - The Details */}
        {deeperGroups.length > 0 && (
          <div className="flex flex-col lg:flex-row gap-16 relative">
            
            {/* Sticky TOC */}
            <aside className="lg:w-64 shrink-0 hidden lg:block">
              <div className="sticky top-32">
                <h3 className="editorial-mono text-xs text-foreground/50 mb-6">In Detail</h3>
                <nav className="flex flex-col gap-4">
                  {deeperGroups.map((group) => (
                    <a 
                      key={`nav-${group.id}`} 
                      href={`#${group.id}`}
                      data-testid={`link-section-${group.id}`}
                      className="text-sm text-foreground/70 hover:text-primary transition-colors block border-l-2 border-transparent hover:border-primary pl-3 -ml-3"
                    >
                      {group.label}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>

            {/* Content */}
            <article className="flex-1 max-w-3xl">
              <div className="mb-12 lg:hidden">
                <div className="flex items-center gap-4 mb-5">
                  <h2 className="editorial-mono text-foreground/50 text-sm font-bold border-b border-border pb-1">In Detail</h2>
                  <div className="flex-1 h-px bg-border"></div>
                </div>
                <nav
                  aria-label="Research sections"
                  className="flex gap-2 overflow-x-auto pb-2"
                  data-testid="research-section-navigation-mobile"
                >
                  {deeperGroups.map((group) => (
                    <a
                      key={`mobile-nav-${group.id}`}
                      href={`#${group.id}`}
                      data-testid={`link-section-mobile-${group.id}`}
                      className="shrink-0 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground/75 transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {group.label}
                    </a>
                  ))}
                </nav>
              </div>

              <div className="space-y-20">
                {deeperGroups.map((group) => (
                  <section key={group.id} id={group.id} className="scroll-mt-32" data-testid={`section-${group.id}`}>
                    <div className="flex items-center gap-4 mb-8">
                      <h2 className="font-serif text-3xl md:text-4xl tracking-tight text-foreground m-0">
                        {group.label}
                      </h2>
                    </div>
                    <div className="prose prose-lg prose-neutral max-w-none prose-p:text-foreground/80 prose-p:leading-loose">
                      <SectionContent content={group.content} isLead={group.id === 'business'} />
                    </div>
                    <div className="mt-8 flex justify-end">
                      <div className="text-[10px] editorial-mono text-muted-foreground flex items-center gap-2">
                        <span className="w-1 h-1 bg-border rounded-full" />
                        <span className="w-1 h-1 bg-border rounded-full" />
                        <span className="w-1 h-1 bg-border rounded-full" />
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </article>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-20 py-12">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-foreground/50">
          <div className="flex items-center gap-2">
            <Wordmark />
            <span className="font-mono text-xs ml-4">Demo Edition</span>
          </div>
          <div className="text-center md:text-right">
            <p>Not investment advice. For demonstration purposes only.</p>
          </div>
        </div>
      </footer>
    </div>
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
