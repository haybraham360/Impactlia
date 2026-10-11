import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// The browser's Supabase client, used only for live subscriptions. Like the
// server's, it keeps no session of its own: it carries the signed-in Clerk
// token, so a subscription is authorised by the same policies as a read.
//
// Both values are public by design and are written out in full because the
// bundler only inlines them that way. lib/env.ts has already stopped the build
// if either is missing.
export function createBrowserSupabaseClient(getToken: () => Promise<string | null>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("The Supabase URL and publishable key are not available in the browser.");
  }
  return createClient<Database>(url, key, { accessToken: getToken });
}
