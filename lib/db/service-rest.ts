import "server-only";

type ServiceMethod = "GET" | "POST" | "PATCH" | "DELETE";
type ServiceOptions = { query?: Record<string, string>; body?: unknown; prefer?: string };
type RestError = { message?: string; code?: string; details?: string };

/** Server-worker transport only. Never import this from UI or user request code. */
export async function serviceRest<T>(method: ServiceMethod, resource: string, options: ServiceOptions = {}): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Supabase server configuration is missing.");
  const query = new URLSearchParams(options.query);
  const response = await fetch(`${url}/rest/v1/${resource}${query.size ? `?${query}` : ""}`, { method, headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", ...(options.prefer ? { prefer: options.prefer } : {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: "no-store" });
  if (!response.ok) { const error = await response.json().catch(() => ({})) as RestError; const message = error.message || `Server database request failed (${response.status}).`; throw Object.assign(new Error(message), { code: error.code }); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
