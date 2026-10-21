import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env, type AutomationConfig } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// The one client that does not act as a member. It bypasses row-level
// security, so it is used only where there is no member to act as: GitHub's
// webhooks, the retry sweep, and linking an installation once GitHub has
// confirmed the member can see it. Each of those takes the organization from
// the installation row, never from anything a request says.
//
// Imported only by lib/automation. Everything a member reads still goes
// through createSupabaseClient and the policies.
export function createServiceSupabaseClient(config: AutomationConfig) {
  return createClient<Database>(env.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>;
