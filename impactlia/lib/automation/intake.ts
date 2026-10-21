import "server-only";
import type { AutomationConfig } from "@/lib/env";
import type { WebhookPlan } from "@/lib/github/webhook";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

// Records what a verified webhook delivery asks for. Each case is one
// database call that records the delivery and its effect in one transaction,
// so a redelivery of the same id is recognised and changes nothing.
//
// Returns the job to start now, if there is one.
export async function recordDelivery(
  config: AutomationConfig,
  deliveryId: string,
  event: string,
  plan: Extract<WebhookPlan, { kind: "queue" | "close" | "installation" }>,
): Promise<{ outcome: string; jobId: string | null }> {
  const db = createServiceSupabaseClient(config);

  if (plan.kind === "queue") {
    const { data, error } = await db.rpc("queue_automatic_analysis", {
      delivery: deliveryId,
      event,
      installation: plan.installationId,
      provider_repository_id: plan.providerRepositoryId,
      pull_request_number: plan.pullRequestNumber,
      head_sha: plan.headSha,
      is_private: plan.isPrivate,
    });
    if (error) throw new Error(`The delivery could not be recorded: ${error.message}`);
    const row = data[0];
    if (!row) throw new Error("Queueing the delivery returned nothing.");
    // null for every outcome but "queued".
    return { outcome: row.outcome, jobId: row.job_id ?? null };
  }

  if (plan.kind === "close") {
    const { data, error } = await db.rpc("close_automatic_analyses", {
      delivery: deliveryId,
      installation: plan.installationId,
      provider_repository_id: plan.providerRepositoryId,
      pull_request_number: plan.pullRequestNumber,
    });
    if (error) throw new Error(`The delivery could not be recorded: ${error.message}`);
    return { outcome: data, jobId: null };
  }

  const { data, error } = await db.rpc("record_github_installation_event", {
    delivery: deliveryId,
    installation: plan.installationId,
    action: plan.action,
  });
  if (error) throw new Error(`The delivery could not be recorded: ${error.message}`);
  return { outcome: data, jobId: null };
}
