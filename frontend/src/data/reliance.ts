export type Signal = 'LOW' | 'WATCH' | 'HIGH';
export type Verdict = 'Strong' | 'Good' | 'Watch' | 'Weak';

export const company = {
  name: 'Reliance Industries',
  shortName: 'RELIANCE',
  exchange: 'NSE · BSE',
  sector: 'Energy, Oil & Gas',
  type: 'Conglomerate',
  price: '₹1,426.30',
  priceChange: '+₹18.45',
  priceChangePct: '+1.31%',
  asOf: 'Sample close · 21 Jun 2024',
  marketCap: '₹19.25 lakh cr',
  lastUpdated: '27 Jun 2024',
};

export const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'business', label: 'Business' },
  { id: 'financials', label: 'Financials' },
  { id: 'cash-flow', label: 'Cash flow' },
  { id: 'balance-sheet', label: 'Balance sheet' },
  { id: 'management', label: 'Management' },
  { id: 'risks', label: 'Risks' },
  { id: 'valuation', label: 'Valuation' },
  { id: 'news', label: 'News' },
];

export const snapshot = [
  { label: 'Market capitalisation', value: '₹19.25 lakh cr', note: 'Approximate sample value' },
  { label: 'FY24 revenue', value: '₹10.00 lakh cr', note: 'Consolidated, sample' },
  { label: 'FY24 EBITDA', value: '₹1.78 lakh cr', note: 'Operating profit before D&A' },
  { label: 'FY24 PAT', value: '₹79,020 cr', note: 'After minority interest' },
  { label: '52-week range', value: '₹1,221 — ₹1,608', note: 'Sample range' },
  { label: 'Research posture', value: 'Understand first', note: 'Not a recommendation' },
];

export const segments = [
  {
    name: 'Oil to Chemicals',
    short: 'O2C',
    share: '54%',
    accent: 'orange',
    does: 'Refines crude oil and turns it into fuels, polymers and chemical building blocks.',
    makes: 'Earns a spread between the cost of crude and the value of refined products and chemicals.',
    why: 'Still the cash engine, but exposed to global product margins and energy cycles.',
  },
  {
    name: 'Digital Services / Jio',
    short: 'Digital',
    share: '22%',
    accent: 'teal',
    does: 'Connects more than 470 million customers through mobile, broadband and digital services.',
    makes: 'Monthly subscriptions, data usage, home broadband and a growing digital ecosystem.',
    why: 'Recurring revenue and scale can make the group more resilient over time.',
  },
  {
    name: 'Retail',
    short: 'Retail',
    share: '16%',
    accent: 'gold',
    does: 'Operates grocery, fashion, electronics and online retail across India.',
    makes: 'Product margins, private labels, store productivity and supplier relationships.',
    why: 'A long runway, but working capital and execution matter more as it grows.',
  },
  {
    name: 'New Energy',
    short: 'New energy',
    share: '3%',
    accent: 'blue',
    does: 'Builds a planned ecosystem for solar modules, batteries, hydrogen and related equipment.',
    makes: 'Not yet a material profit pool; future economics depend on cost and scale.',
    why: 'Large optionality, with meaningful upfront capex and delivery risk.',
  },
  {
    name: 'Other businesses',
    short: 'Other',
    share: '5%',
    accent: 'plum',
    does: 'Includes media, entertainment, financial services and smaller group activities.',
    makes: 'A mix of subscription, advertising, transaction and investment income.',
    why: 'Small today, but useful context for the conglomerate’s full picture.',
  },
];

export const financials = [
  { label: 'Revenue', value: '₹10.00L cr', change: '-2.1%', direction: 'down', values: [58, 72, 68, 84, 78, 74, 81] },
  { label: 'EBITDA', value: '₹1.78L cr', change: '+2.6%', direction: 'up', values: [44, 53, 57, 60, 67, 63, 71] },
  { label: 'EBITDA margin', value: '17.8%', change: '+80 bps', direction: 'up', values: [40, 46, 43, 52, 55, 59, 66] },
  { label: 'PAT', value: '₹79,020 cr', change: '+1.3%', direction: 'up', values: [34, 41, 39, 51, 48, 58, 64] },
  { label: 'EPS', value: '₹116.40', change: '+0.8%', direction: 'up', values: [30, 40, 37, 50, 47, 56, 62] },
  { label: 'ROCE', value: '9.7%', change: '-40 bps', direction: 'down', values: [63, 59, 55, 58, 54, 51, 49] },
  { label: 'Debt', value: '₹3.10L cr', change: '+4.2%', direction: 'up', values: [47, 50, 54, 52, 58, 62, 67] },
  { label: 'Free cash flow', value: '₹58,300 cr', change: '-11.6%', direction: 'down', values: [72, 67, 74, 61, 65, 56, 52] },
];

export const earningsDrivers = [
  { title: 'Revenue', tone: 'neutral', text: 'Revenue softened as crude-linked prices and product realisations eased. Volumes were steadier than the headline number suggests.' },
  { title: 'Margins', tone: 'positive', text: 'A better O2C mix and stronger digital profitability offset some pressure in retail investment.' },
  { title: 'Segment performance', tone: 'positive', text: 'Digital services continued to grow EBITDA. O2C remained the largest contributor, while retail added stores ahead of full maturity.' },
  { title: 'Costs', tone: 'watch', text: 'Employee, network and new-energy build-out costs rose faster than the group’s revenue in selected businesses.' },
  { title: 'One-off factors', tone: 'watch', text: 'The comparison includes exceptional items and a softer base in some commodities. Treat the year-on-year PAT change with care.' },
];

export const cashFlow = [
  { label: 'Profit', value: '₹79,020 cr', sub: 'Reported PAT' },
  { label: 'Operating cash flow', value: '₹1.48L cr', sub: 'Cash from day-to-day operations' },
  { label: 'Capex', value: '₹89,700 cr', sub: 'Expansion and maintenance spend' },
  { label: 'Free cash flow', value: '₹58,300 cr', sub: 'Operating cash flow less capex' },
];

export const balanceSheet = [
  { label: 'Debt', value: '₹3.10L cr', delta: '+4.2%', tone: 'watch' },
  { label: 'Cash & liquid investments', value: '₹2.09L cr', delta: '+8.1%', tone: 'positive' },
  { label: 'Receivables', value: '₹86,400 cr', delta: '+11.5%', tone: 'watch' },
  { label: 'Inventory', value: '₹1.54L cr', delta: '-3.2%', tone: 'positive' },
  { label: 'Payables', value: '₹1.82L cr', delta: '+5.8%', tone: 'neutral' },
];

export const crossChecks = [
  { title: 'Revenue vs Receivables', signal: 'WATCH' as Signal, finding: 'Receivables grew faster than revenue this year.', why: 'It may reflect timing and mix, but collections deserve attention in the next two quarters.' },
  { title: 'Profit vs Operating Cash Flow', signal: 'LOW' as Signal, finding: 'Operating cash flow remains comfortably above reported profit.', why: 'Cash conversion is a reassuring feature of the current financial story.' },
  { title: 'Inventory vs Revenue', signal: 'LOW' as Signal, finding: 'Inventory reduced while revenue was broadly stable.', why: 'There is no obvious build-up of unsold product in this sample period.' },
  { title: 'Debt vs EBITDA', signal: 'WATCH' as Signal, finding: 'Debt rose while EBITDA growth was modest.', why: 'Leverage remains manageable, but capex returns need to catch up with funding costs.' },
  { title: 'Capex vs Cash Flow', signal: 'WATCH' as Signal, finding: 'Capex absorbed a larger share of operating cash than last year.', why: 'This is normal during build-out, but free cash flow can stay uneven until new assets mature.' },
];

export const redFlags = [
  { no: '01', title: 'A large investment cycle is still underway', body: 'New energy and retail expansion need patient capital before their earnings contribution is visible.', signal: 'WATCH' as Signal },
  { no: '02', title: 'O2C remains cycle-sensitive', body: 'A weak global refining or chemical margin can move the largest profit pool quickly.', signal: 'WATCH' as Signal },
  { no: '03', title: 'Receivables need a clean follow-through', body: 'The year’s growth is not fully matched by collection speed. This is an observation, not an accusation of wrongdoing.', signal: 'WATCH' as Signal },
  { no: '04', title: 'Conglomerate complexity hides trade-offs', body: 'Strong segments can subsidise newer businesses, making return on capital harder to read.', signal: 'LOW' as Signal },
  { no: '05', title: 'Execution is now as important as ambition', body: 'The market has already heard big targets; delivery milestones will matter more than announcements.', signal: 'WATCH' as Signal },
];

export const commentary = [
  { promise: 'Scale Jio from connectivity into a wider digital ecosystem', status: 'On track', detail: 'Customer base and ARPU direction support the early phase of this plan.' },
  { promise: 'Make retail a national, multi-format platform', status: 'On track', detail: 'Store additions continue, though mature-store economics are the next proof point.' },
  { promise: 'Build a competitive new-energy manufacturing ecosystem', status: 'Too early to judge', detail: 'Capacity plans are visible; returns and customer demand are not yet observable.' },
  { promise: 'De-lever while funding the next capex cycle', status: 'Partially achieved', detail: 'Cash balances are stronger, but gross debt has not yet declined.' },
];

export const shareholding = [
  { label: 'Promoter & promoter group', value: 50.3, color: 'teal' },
  { label: 'Foreign institutions', value: 18.7, color: 'orange' },
  { label: 'Domestic institutions', value: 14.4, color: 'blue' },
  { label: 'Public & others', value: 16.6, color: 'sand' },
];

export const valuation = {
  movement: 'The sample price is 11.4% below the 52-week high, after a period where commodity sentiment cooled and investors questioned the pace of new-energy returns.',
  earnings: 'FY24 earnings were steadier than the headline revenue decline: digital and a better mix helped protect EBITDA.',
  current: 'Sample multiples: 24.8× forward P/E · 2.1× price/book · 11.2× EV/EBITDA',
  historical: 'Five-year sample median: 25.6× forward P/E · 2.3× price/book · 12.0× EV/EBITDA',
  expectations: 'Available expectations imply mid-teens EBITDA growth over the next two years, led by digital, retail and a normalising O2C cycle.',
  conclusion: 'The recent bad news looks partly reflected, not fully resolved. The valuation is less demanding than the group’s recent peak, but it still assumes execution across several businesses.',
};

export const questions = [
  'What is the expected return on capital and break-even timeline for each new-energy manufacturing unit?',
  'How should investors think about the steady-state margin for the retail formats opened in the last 18 months?',
  'What is the group’s preferred debt ceiling while the next capex cycle is funded?',
  'Which O2C product spreads are most important to the next two quarters?',
  'What collection actions explain receivables growing faster than revenue in FY24?',
  'When will Jio’s digital services become a separately visible profit pool?',
  'What milestones would make management slow or accelerate new-energy capex?',
  'How does the board measure promise delivery beyond headline capacity additions?',
];

export const news = [
  { date: '21 Jun 2024', category: 'MARKETS', headline: 'Reliance shares recover as investors look past a softer commodity quarter', why: 'Shows that price action is reacting to the mix of businesses, not just O2C numbers.' },
  { date: '14 Jun 2024', category: 'DIGITAL', headline: 'Jio adds scale in 5G and home broadband across priority circles', why: 'Supports the recurring-revenue part of the investment case.' },
  { date: '04 Jun 2024', category: 'RETAIL', headline: 'Retail expands private-label presence in grocery and consumer electronics', why: 'Private labels can improve margins, but inventory discipline matters.' },
  { date: '22 May 2024', category: 'NEW ENERGY', headline: 'New-energy campus moves from plans towards visible manufacturing milestones', why: 'The market now needs proof of cost competitiveness, not only capacity.' },
  { date: '08 May 2024', category: 'O2C', headline: 'Global refining margins cool after a strong start to the year', why: 'A reminder that the largest current earnings pool is cyclical.' },
];

export const monitor = [
  'O2C cracks and chemical spreads: the quickest read on the current cash engine.',
  'Jio ARPU, 5G adoption and home broadband additions: evidence of monetisation beyond subscriber scale.',
  'Retail same-store growth and inventory turns: whether expansion is becoming more productive.',
  'New-energy commissioning, customer orders and capex phasing: proof over promise.',
  'Net debt / EBITDA and free cash flow after capex: the group’s financial flexibility.',
];

export const overall = [
  { label: 'Business quality', value: 'Strong' as Verdict, note: 'Rare breadth, scale and multiple reinvestment options.' },
  { label: 'Growth', value: 'Good' as Verdict, note: 'Digital and retail help, while new energy is still an option.' },
  { label: 'Financial health', value: 'Good' as Verdict, note: 'Liquidity is a buffer; gross debt is still worth tracking.' },
  { label: 'Cash flow', value: 'Good' as Verdict, note: 'Cash conversion is solid, though capex makes FCF uneven.' },
  { label: 'Management execution', value: 'Watch' as Verdict, note: 'The promise list is large; delivery is the next proof point.' },
  { label: 'Valuation', value: 'Watch' as Verdict, note: 'Not at peak sample multiples, but far from a no-expectations price.' },
  { label: 'Risk', value: 'Watch' as Verdict, note: 'Cycle exposure and conglomerate complexity require context.' },
];