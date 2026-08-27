import { logger } from "../logger.js";

type RestMethod = "GET" | "POST" | "PATCH" | "DELETE";

export class SupabaseRestError extends Error {
  readonly method: RestMethod;
  readonly path: string;
  readonly status: number;
  readonly responseBody: string;

  constructor(method: RestMethod, path: string, status: number, responseBody: string) {
    super(
      `Supabase ${method} ${path} failed with HTTP ${status}` +
        (responseBody ? `: ${responseBody.slice(0, 300)}` : ""),
    );
    this.name = "SupabaseRestError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.responseBody = responseBody;
  }
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("Supabase is not configured");
  }

  return { url, key };
}

export async function supabaseRest<T>(
  method: RestMethod,
  path: string,
  options: {
    body?: unknown;
    prefer?: string;
  } = {},
): Promise<T> {
  const { url, key } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const responseBody = await response.text();

  if (!response.ok) {
    logger.error(
      { method, path, status: response.status, responseBody: responseBody.slice(0, 300) },
      "Supabase research request failed",
    );
    throw new SupabaseRestError(method, path, response.status, responseBody);
  }

  if (!responseBody) {
    return undefined as T;
  }

  try {
    return JSON.parse(responseBody) as T;
  } catch (error) {
    throw new Error(
      `Supabase ${method} ${path} returned invalid JSON: ${String(error)}`,
    );
  }
}