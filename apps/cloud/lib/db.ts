import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the SERVICE-ROLE key.
 *
 * This client bypasses Row Level Security entirely — it must only ever be
 * imported from server code (route handlers). Never expose it to the browser.
 *
 * Created lazily so `next build` does not require env vars to be present.
 */
let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)"
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
