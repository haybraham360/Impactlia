import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Sessions belong to Clerk. Supabase keeps none of its own: every request
// carries the signed-in Clerk token, which is what lets row-level security
// policies read the organization claim.
export function createSupabaseClient() {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => (await auth()).getToken(),
  });
}
