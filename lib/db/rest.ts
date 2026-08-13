import "server-only";
import { createClient } from "@/lib/supabase/server";

type RestMethod = "GET" | "POST" | "PATCH" | "DELETE";
type RestOptions = { query?: Record<string, string>; body?: unknown; prefer?: string };
type RestError = { message?: string; code?: string; details?: string; hint?: string };

/**
 * Executes VA domain requests under the current user's JWT. This is temporary glue
 * while the linked database migration is awaiting a CLI access token and types can
 * be regenerated; it intentionally never uses the service key for user data.
 */
export async function userRest<T>(method: RestMethod, resource: string, options: RestOptions = {}): Promise<T> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Authentication is required.");
  const query = new URLSearchParams(options.query);
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${resource}${query.size ? `?${query}` : ""}`, {
    method,
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as RestError;
    // PostgREST messages describe invalid input but never include credentials.
    const message = error.code === "22P02"
      ? "A record reference must be a valid UUID. Select an authorized record instead of entering a name or label."
      : error.message || `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
