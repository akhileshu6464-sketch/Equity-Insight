type SupabaseCompanyRow = {
  id: string;
  name: string;
  ticker: string;
  exchange: string;
  sector: string;
  industry: string;
  short_description: string;
  updated_at: string;
};

type SupabaseResearchRow = {
  id: string;
  section: string;
  title: string;
  content: string;
  last_updated: string;
};

export type StockLensCompany = SupabaseCompanyRow;
export type StockLensResearchSection = SupabaseResearchRow;

class SupabaseRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SupabaseRequestError";
    this.status = status;
  }
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new SupabaseRequestError(
      503,
      "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  }

  return { url, key };
}

async function supabaseRequest<T>(path: string): Promise<T> {
  const { url, key } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1${path}`, {
    headers: {
      Accept: "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new SupabaseRequestError(
      503,
      `Supabase request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

function cleanSearchTerm(value: string) {
  return value
    .trim()
    .replace(/[^\p{L}\p{N} .&'-]/gu, "")
    .slice(0, 80);
}

function ilikeFilter(value: string) {
  return `*${value.replace(/[%_*]/g, "")}*`;
}

export async function searchCompanies(search: string) {
  const term = cleanSearchTerm(search);
  if (!term) return [];

  const select =
    "id,name,ticker,exchange,short_description";
  const nameParams = new URLSearchParams({
    select,
    name: `ilike.${ilikeFilter(term)}`,
    limit: "10",
  });
  const tickerParams = new URLSearchParams({
    select,
    ticker: `ilike.${ilikeFilter(term.toUpperCase())}`,
    limit: "10",
  });

  const [nameMatches, tickerMatches] = await Promise.all([
    supabaseRequest<
      Array<Pick<StockLensCompany, "id" | "name" | "ticker" | "exchange" | "short_description">>
    >(`/companies?${nameParams.toString()}`),
    supabaseRequest<
      Array<Pick<StockLensCompany, "id" | "name" | "ticker" | "exchange" | "short_description">>
    >(`/companies?${tickerParams.toString()}`),
  ]);

  const seen = new Set<string>();
  return [...nameMatches, ...tickerMatches].filter((company) => {
    if (seen.has(company.id)) return false;
    seen.add(company.id);
    return true;
  });
}

export async function getCompanyResearch(ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const companyParams = new URLSearchParams({
    select:
      "id,name,ticker,exchange,sector,industry,short_description,updated_at",
    ticker: `eq.${normalizedTicker}`,
    limit: "1",
  });
  const companies = await supabaseRequest<StockLensCompany[]>(
    `/companies?${companyParams.toString()}`,
  );
  const company = companies[0];

  if (!company) return null;

  const researchParams = new URLSearchParams({
    select: "id,section,title,content,last_updated",
    company_id: `eq.${company.id}`,
    order: "created_at.asc",
  });
  const research = await supabaseRequest<StockLensResearchSection[]>(
    `/research?${researchParams.toString()}`,
  );

  return { company, research };
}
