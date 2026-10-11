import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// Sessions belong to Clerk. Supabase keeps none of its own: every request
// carries the signed-in Clerk token, which is what lets row-level security
// policies read the organization claim.
export function createSupabaseClient() {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => (await auth()).getToken(),
  });
}

// Long enough for a whole repository run, which stops itself after four
// minutes, plus the work either side of it.
const RUN_TOKEN_SECONDS = 600;

// For the work that outlives a request. The request's own token lasts about a
// minute and a repository run can take longer, so this asks Clerk for a token
// for the same session that lasts the length of a run. It is still the
// member's token: the database policies decide every write made with it.
export async function createRunSupabaseClient() {
  const { sessionId } = await auth();
  if (!sessionId) {
    throw new Error("A repository run can only be started from a signed-in session.");
  }
  const clerk = await clerkClient();
  const { jwt } = await clerk.sessions.getToken(sessionId, undefined, RUN_TOKEN_SECONDS);
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => jwt,
  });
}

export type SupabaseClient = ReturnType<typeof createSupabaseClient>;
