import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const sections = [
  ['what-it-does', 'What it does'],
  ['how-it-makes-money', 'How it makes money'],
  ['business-change', 'What happened'],
  ['earnings-change', 'Why earnings changed'],
  ['cash-flow', 'Cash flow quality'],
  ['numbers-make-sense', 'Do the numbers make sense?'],
  ['going-well', 'What is going well'],
  ['going-wrong', 'What is going wrong'],
  ['red-flags', 'Red flags'],
  ['management', 'Management & delivery'],
  ['stock-move', 'Why the stock moved'],
  ['priced-in', 'Is bad news priced in?'],
  ['risks', 'What could go wrong'],
  ['watch-next', 'What to watch next'],
];

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
  const [submitted, setSubmitted] = useState(false);

  const search = (value: string) => {
    const cleaned = value.trim();
    setQuery(cleaned);
    if (cleaned.toLowerCase().includes('reliance') || cleaned.toLowerCase() === 'reliance') {
      setLocation('/research/reliance');
      return;
    }
    setSubmitted(true);
  };

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
                    setSubmitted(false);
                  }}
                  placeholder="Search company name or stock symbol"
                  aria-label="Search company name or stock symbol"
                />
                <button className="sl-search-submit" type="submit" data-testid="button-submit-search">
                  Read the research
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
              {submitted && (
                <div className="sl-error-search sl-fade-in" data-testid="status-no-results">
                  We do not have a finished note for “{query || 'that search'}” yet. Try the example above — it opens our Reliance research note.
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
  children,
  className = '',
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`sl-section ${className}`} data-testid={`section-${id}`}>
      <div className="sl-section-number">{number}</div>
      <h2 className="sl-serif">{title}</h2>
      {children}
    </section>
  );
}

function InsightTriplet({
  happened,
  why,
  matters,
}: {
  happened: string;
  why: string;
  matters: string;
}) {
  return (
    <div className="sl-triplet">
      <div className="sl-triplet-card">
        <h3>What happened?</h3>
        <p>{happened}</p>
      </div>
      <div className="sl-triplet-card">
        <h3>Why?</h3>
        <p>{why}</p>
      </div>
      <div className="sl-triplet-card">
        <h3>Why does it matter?</h3>
        <p>{matters}</p>
      </div>
    </div>
  );
}

function RedFlag({
  title,
  severity,
  fact,
  analysis,
  risk,
}: {
  title: string;
  severity: 'Watch' | 'Moderate' | 'High';
  fact: string;
  analysis: string;
  risk: string;
}) {
  return (
    <article className="sl-redflag" data-testid={`red-flag-${title.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="sl-redflag-top">
        <h3 className="sl-serif">{title}</h3>
        <span className={`sl-label ${severity === 'High' ? 'red' : severity === 'Moderate' ? 'watch' : ''}`}>{severity}</span>
      </div>
      <dl>
        <dt>Fact</dt>
        <dd>{fact}</dd>
        <dt>Analysis</dt>
        <dd>{analysis}</dd>
        <dt>Possible risk</dt>
        <dd>{risk}</dd>
      </dl>
    </article>
  );
}

function ResearchPage() {
  return (
    <main className="sl-shell">
      <header className="sl-research-header">
        <div className="sl-container sl-research-nav">
          <Link href="/" className="sl-back" data-testid="link-back-to-search">← Back to search</Link>
          <div className="sl-research-meta">
            <span className="sl-wordmark">stock<span>lens</span></span>
            <span className="ticker">NSE: RELIANCE</span>
          </div>
        </div>
      </header>

      <div className="sl-container">
        <header className="sl-article-head sl-fade-in">
          <div className="sl-kicker">Company research · prototype note</div>
          <h1 className="sl-serif">Reliance<br />Industries</h1>
          <p className="sl-dek">Everything you need to understand the company — without reading 200 pages of filings first.</p>
          <div className="sl-update-note">SAMPLE ANALYSIS · DATA THROUGH FY24 / Q1 FY25 · NOT LIVE ADVICE</div>
        </header>

        <div className="sl-layout">
          <nav className="sl-sticky-nav" aria-label="Research sections" data-testid="research-section-navigation">
            <p>On this page</p>
            {sections.map(([id, label], index) => (
              <a href={`#${id}`} key={id} data-testid={`link-section-${id}`}>
                {String(index + 1).padStart(2, '0')} {label}
              </a>
            ))}
          </nav>

          <article>
            <ResearchSection id="what-it-does" number="01" title="What does Reliance actually do?">
              <p className="sl-section-lede">Reliance is not one business. It is a group of large businesses that touch how India communicates, shops and uses energy.</p>
              <p className="sl-body-copy">Its consumer businesses are Jio, which connects people to mobile data and digital services, and Reliance Retail, which sells everything from groceries to fashion and electronics. Its older energy businesses buy crude oil, turn it into fuels and chemicals, and sell them in India and overseas.</p>
              <p className="sl-body-copy">Jio and Retail matter because they can grow with Indian households. Oil-to-Chemicals, or O2C, still matters because it is large and generates cash — but its earnings move with global product prices and supply.</p>
              <div className="sl-understand-grid">
                <div className="sl-understand-cell"><small>Jio</small><p>Mobile connections, broadband, apps and digital services for consumers and businesses.</p></div>
                <div className="sl-understand-cell"><small>Retail</small><p>Grocery, fashion, electronics and online commerce sold through stores and digital channels.</p></div>
                <div className="sl-understand-cell"><small>O2C</small><p>Refining crude oil and making petrochemicals used in plastics, packaging and industry.</p></div>
                <div className="sl-understand-cell"><small>New energy</small><p>A planned manufacturing ecosystem for solar modules, batteries, hydrogen and related equipment.</p></div>
              </div>
            </ResearchSection>

            <ResearchSection id="how-it-makes-money" number="02" title="How does Reliance make money?">
              <p className="sl-section-lede">The simple version: recurring consumer payments are growing, while the energy arm remains a powerful but more cyclical cash engine.</p>
              <div className="sl-money-list">
                <div className="sl-money-item"><h3>Jio</h3><p>Customers pay monthly for mobile data, calls, home broadband and digital subscriptions. As usage rises and more users move to higher plans, each customer can become more valuable.</p></div>
                <div className="sl-money-item"><h3>Retail</h3><p>Retail earns a margin on products it buys and sells. Scale helps it negotiate with suppliers; store growth and private-label products can improve the economics over time.</p></div>
                <div className="sl-money-item"><h3>O2C</h3><p>Reliance buys crude and sells fuels and chemicals. The gap between input cost and selling price is the profit. That gap can change quickly with oil supply, demand and competition.</p></div>
                <div className="sl-money-item"><h3>New energy</h3><p>For now, this is an investment story rather than a meaningful profit pool. The future case depends on factories being built on time and products becoming cost competitive.</p></div>
              </div>
            </ResearchSection>

            <ResearchSection id="business-change" number="03" title="What happened to the business?">
              <p className="sl-section-lede">The company kept growing, but the mix changed. The newer consumer engines did the heavy lifting while O2C had a softer year.</p>
              <div className="sl-what-happened">
                <strong>Revenue is not the whole story.</strong>
                <p>In this sample period, consolidated revenue was broadly flat to slightly lower because energy realisations were weaker. Profit still improved as Jio and Retail grew and finance costs eased. The decline was not spread evenly across the group.</p>
              </div>
              <InsightTriplet happened="O2C profit came under pressure, while Jio added subscribers and Retail expanded its network." why="Global chemical spreads and fuel margins cooled from a strong prior year. Consumer demand and tariff-led growth partly offset that pressure." matters="A more balanced Reliance is less dependent on one good energy cycle. The question is whether consumer growth can become large enough to carry the group through weak O2C periods." />
            </ResearchSection>

            <ResearchSection id="earnings-change" number="04" title="Why did earnings change?">
              <p className="sl-section-lede">The chain is easier to see when separated from the headline profit number.</p>
              <InsightTriplet happened="Consolidated profit grew in the sample period, even as reported revenue did not show the same pace." why="Jio benefited from better pricing and data use, and Retail added stores. O2C margins normalised after an unusually strong earlier period." matters="The quality of growth is improving, but the group still has two different earnings clocks: recurring consumer income and volatile global commodity income." />
              <div className="sl-assessment">
                <div className="sl-assessment-head"><h3>Our read</h3><span className="sl-label good">Constructive, with a caveat</span></div>
                <p>Profit growth is more reassuring when it comes from customer additions and better mix, not only from a temporary energy margin. Keep checking whether consumer margins hold as Reliance spends to build scale.</p>
              </div>
            </ResearchSection>

            <ResearchSection id="cash-flow" number="05" title="Why did cash flow change?">
              <p className="sl-section-lede">Profit tells us what the accounts earned. Cash tells us what the businesses actually collected after paying suppliers and funding growth.</p>
              <p className="sl-body-copy">In this sample, Reliance reported about ₹79,000 crore of consolidated profit and generated roughly ₹1,29,000 crore of cash from operations. That is a healthy relationship: the group generated more operating cash than accounting profit.</p>
              <p className="sl-body-copy">Some cash was absorbed by inventory and receivables as Retail expanded. Capital expenditure remained high at around ₹1,31,000 crore, reflecting network, stores and new-energy projects. High capex is not automatically bad here; the test is whether it creates future cash earnings.</p>
              <div className="sl-assessment">
                <div className="sl-assessment-head"><h3>Cash-flow quality</h3><span className="sl-label good">Normal</span></div>
                <p>Operating cash is comfortably positive and above reported profit. Working capital needs watching because a growing retail network naturally uses cash before it earns a full return. For now this looks like growth investment, not a cash warning.</p>
              </div>
            </ResearchSection>

            <ResearchSection id="numbers-make-sense" number="06" title="Do the numbers actually make sense?">
              <p className="sl-section-lede">No single ratio answers this. We connect a few simple relationships and ask what story they tell together.</p>
              <div className="sl-disclosures">
                <details className="sl-disclosure" open>
                  <summary data-testid="button-expand-profit-cash">Profit versus cash</summary>
                  <div className="sl-disclosure-content"><p><strong>Finding:</strong> operating cash was higher than profit in the sample year.</p><p>That suggests profit is being collected, not just booked. The result is helped by non-cash charges and timing, so it should be checked over several years rather than celebrated once.</p></div>
                </details>
                <details className="sl-disclosure">
                  <summary data-testid="button-expand-receivables">Revenue versus receivables</summary>
                  <div className="sl-disclosure-content"><p><strong>Finding:</strong> receivables grew somewhat faster than revenue as new businesses scaled.</p><p>More money is getting stuck with customers and partners. This is not proof of a problem; it becomes a problem if the gap keeps widening or collections slow.</p></div>
                </details>
                <details className="sl-disclosure">
                  <summary data-testid="button-expand-debt">Debt versus earnings</summary>
                  <div className="sl-disclosure-content"><p><strong>Finding:</strong> leverage is manageable against the group's cash generation, but the number matters less than where the money is invested.</p><p>Debt-funded capex works when Jio, Retail and new energy earn returns. A long delay in those returns would make the balance sheet feel heavier.</p></div>
                </details>
              </div>
            </ResearchSection>

            <ResearchSection id="going-well" number="07" title="What is going well?">
              <p className="sl-section-lede">There are real positives here, not just a large-company halo.</p>
              <ul className="sl-list">
                <li><strong>Jio is becoming a steadier earnings engine.</strong> Tariff increases, 5G adoption and home broadband give it several ways to grow revenue per customer.</li>
                <li><strong>Retail is still adding reach.</strong> Store expansion and a wider product mix can make each customer relationship more valuable, if new stores mature well.</li>
                <li><strong>The group can fund its ambitions.</strong> Strong operating cash gives Reliance room to invest without depending entirely on fresh borrowing.</li>
                <li><strong>The business mix is changing.</strong> Consumer platforms are gradually reducing the company’s dependence on a single energy cycle.</li>
              </ul>
            </ResearchSection>

            <ResearchSection id="going-wrong" number="08" title="What is going wrong?">
              <p className="sl-section-lede">The concerns are mostly about execution and the price paid for future growth.</p>
              <ul className="sl-list">
                <li><strong>O2C has less room for easy growth.</strong> Weaker global margins and new capacity can keep pressure on a business that used to be the group's star.</li>
                <li><strong>Retail is cash hungry while it scales.</strong> Inventory, stores and working capital rise before every new location proves it can earn a good return.</li>
                <li><strong>New energy is still a promise.</strong> The spending is visible today; the cash earnings are several years away and depend on difficult manufacturing execution.</li>
                <li><strong>Expectations are high.</strong> A company can report good growth and still disappoint if investors had already priced in even better growth.</li>
              </ul>
            </ResearchSection>

            <ResearchSection id="red-flags" number="09" title="Red flags to keep in view">
              <p className="sl-section-lede">These are signals to investigate, not accusations. Unusual numbers need context before they deserve a strong conclusion.</p>
              <RedFlag title="Receivables are growing faster than revenue" severity="Watch" fact="Sample receivables rose about 18% while revenue rose about 8%." analysis="The gap may reflect Retail partnerships, timing and a larger digital ecosystem." risk="If it persists, more cash could be tied up and reported profit could arrive later as cash." />
              <RedFlag title="Capex is running ahead of visible returns" severity="Moderate" fact="Annual capex is around ₹1.31 lakh crore, including consumer networks and new-energy projects." analysis="Reliance is deliberately investing ahead of demand in businesses that could be large later." risk="A delay in commissioning or weak returns could reduce free cash flow and increase balance-sheet pressure." />
              <RedFlag title="O2C profits can turn quickly" severity="Watch" fact="Energy and chemical margins have cooled from the prior peak." analysis="This is normal for a cyclical business, but the group's absolute profit is still sensitive to it." risk="A prolonged downcycle could offset good Jio and Retail growth more than investors expect." />
              <RedFlag title="New energy execution is unproven" severity="Moderate" fact="Large manufacturing plans are under development, with limited operating history today." analysis="The opportunity is meaningful, but forecasts rely on costs, yields and demand that are not yet demonstrated." risk="If scale or competitiveness arrives late, returns on invested capital may be lower than the story suggests." />
            </ResearchSection>

            <ResearchSection id="management" number="10" title="What is management saying — and did it deliver?">
              <p className="sl-section-lede">Management’s message is consistent: invest through the cycle, make consumer businesses bigger, and build the next energy platform.</p>
              <InsightTriplet happened="Management has pointed to continued Jio monetisation, Retail expansion and new-energy commissioning as the next growth legs." why="The group sees data use, formal retail and India's energy transition as long-term opportunities." matters="The strategy makes sense only if capital turns into customer cash flows at a reasonable return, not just bigger reported revenue." />
              <div className="sl-assessment">
                <div className="sl-assessment-head"><h3>Did management deliver?</h3><span className="sl-label watch">Mixed to good</span></div>
                <p>Jio's network and tariff execution broadly matched earlier direction, and Retail kept expanding. O2C was always exposed to outside prices. New-energy delivery is not yet proven at the scale implied by the plan, so this is the area where words still need to become operating evidence.</p>
              </div>
            </ResearchSection>

            <ResearchSection id="stock-move" number="11" title="Why did the stock move?">
              <p className="sl-section-lede">The market usually reacts to the gap between what it expected and what it heard — not to whether a result looks good in isolation.</p>
              <p className="sl-body-copy">In the sample period, the stock was supported by stronger Jio and Retail expectations, but enthusiasm was checked by softer O2C margins and questions about how much capital new energy will consume. Investors were looking beyond one quarter: they wanted proof that the consumer businesses can replace the old energy profit engine over time.</p>
              <p className="sl-body-copy">So the move was less “earnings were bad” and more “the good parts were partly expected, while the timing and returns on the next investment cycle remain uncertain”.</p>
            </ResearchSection>

            <ResearchSection id="priced-in" number="12" title="Has the bad news already been priced in?">
              <p className="sl-section-lede">Some of the O2C slowdown appears understood. That does not automatically make the stock cheap.</p>
              <div className="sl-assessment">
                <div className="sl-assessment-head"><h3>Analytical assessment</h3><span className="sl-label watch">Not a certainty</span></div>
                <p>The stock has had periods of weakness while earnings expectations also came down. That means a part of the bad news may be reflected, but the valuation still depends on future Jio, Retail and new-energy cash flows. If those arrive later than expected, the share price can remain under pressure even after a fall.</p>
              </div>
              <p className="sl-body-copy" style={{ marginTop: '22px' }}>The useful question is not “has it fallen enough?” It is whether the future earnings people are paying for arrive on time, with healthy cash conversion.</p>
            </ResearchSection>

            <ResearchSection id="risks" number="13" title="What could go wrong?">
              <p className="sl-section-lede">Five company-specific risks deserve a place beside the growth story.</p>
              <ol className="sl-number-list">
                <li><span><strong>Consumer competition:</strong> rivals could force lower tariffs or higher customer-acquisition spending, reducing Jio and Retail margins.</span></li>
                <li><span><strong>O2C downcycle:</strong> weak fuel and chemical spreads could last longer than expected and hold back group profit.</span></li>
                <li><span><strong>Capital allocation:</strong> large projects may earn less, or much later, than the returns investors currently assume.</span></li>
                <li><span><strong>Regulation:</strong> telecom rules, spectrum costs, data policy or retail regulation could change the economics.</span></li>
                <li><span><strong>Execution complexity:</strong> managing stores, networks, factories and a commodity chain at once creates more places for delays and cost overruns.</span></li>
              </ol>
            </ResearchSection>

            <ResearchSection id="watch-next" number="14" title="What should investors watch next?">
              <p className="sl-section-lede">These five checks will tell us more than a single headline result.</p>
              <ol className="sl-number-list">
                <li><span><strong>Jio’s customer value:</strong> are tariffs and data use lifting revenue per user without unusually high churn?</span></li>
                <li><span><strong>Retail cash discipline:</strong> are new stores maturing, and are inventory and receivables growing slower than sales?</span></li>
                <li><span><strong>O2C margins:</strong> are refining and chemical spreads stabilising, or is the weak cycle deepening?</span></li>
                <li><span><strong>New-energy milestones:</strong> are plants commissioned on schedule, at the promised cost and quality?</span></li>
                <li><span><strong>Cash after capex:</strong> is operating cash beginning to cover the group's large investment programme?</span></li>
              </ol>
            </ResearchSection>

            <ResearchSection id="conclusion" number="15" title="Reliance in 60 seconds" className="sl-conclusion">
              <p className="sl-section-lede">Reliance is becoming a consumer-and-energy platform rather than only an energy company.</p>
              <p className="sl-body-copy">Jio and Retail are the good part of the transition: they offer recurring customer relationships and long runways in India. Operating cash is healthy, and the group has the scale to keep investing.</p>
              <p className="sl-body-copy">The hard part is that the company is spending heavily before every future business has proved its returns. O2C remains cyclical, and new energy is still a plan being executed. The biggest risk is not one bad quarter; it is capital earning less, or later, than expected.</p>
              <p className="sl-body-copy">The most important thing to watch is simple: do Jio, Retail and new energy turn the money invested today into durable cash generation tomorrow?</p>
              <div className="sl-caution">This is a prototype research explanation based on illustrative sample information. It is not live data, a recommendation, or investment advice.</div>
              <Link href="/" className="sl-return" data-testid="link-return-to-search">Search another company</Link>
            </ResearchSection>
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
        <Route path="/research/reliance" component={ResearchPage} />
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
