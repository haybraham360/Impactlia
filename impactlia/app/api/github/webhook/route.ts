import { after } from "next/server";
import { recordDelivery } from "@/lib/automation/intake";
import { processAutomaticAnalysis } from "@/lib/automation/run";
import { automation } from "@/lib/env";
import { isDeliveryId, planWebhook, verifySignature } from "@/lib/github/webhook";

// GitHub's webhooks for the Impactlia GitHub App. Public: GitHub signs each
// delivery with the webhook secret, and nothing is read from the payload
// until that signature checks out.
//
// The answer goes back quickly. A queued analysis starts after the response
// in this same function; if it cannot start now (another job of the
// repository is running) the retry sweep starts it.

// The analysis that starts after the response shares this function's time.
export const maxDuration = 300;

// GitHub caps payloads at 25 MB; pull_request payloads are far smaller.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const reply = (status: number, body: Record<string, string>) => Response.json(body, { status });

export async function POST(request: Request): Promise<Response> {
  const config = automation.config;
  if (!config) return reply(503, { error: "Automatic analysis is not set up on this server." });

  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return reply(413, { error: "The payload is too large." });
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return reply(413, { error: "The payload is too large." });
  }
  if (!verifySignature(config.webhookSecret, body, request.headers.get("x-hub-signature-256"))) {
    return reply(401, { error: "The signature does not match." });
  }

  const event = request.headers.get("x-github-event");
  const delivery = request.headers.get("x-github-delivery");
  if (!event || event.length > 100 || !isDeliveryId(delivery)) {
    return reply(400, { error: "The event or delivery header is missing." });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, { error: "The payload is not JSON." });
  }

  const plan = planWebhook(event, payload);
  if (plan.kind === "invalid") return reply(400, { error: plan.reason });
  if (plan.kind === "ignore") return reply(202, { outcome: "ignored" });

  let recorded: { outcome: string; jobId: string | null };
  try {
    recorded = await recordDelivery(config, delivery, event, plan);
  } catch (error) {
    // GitHub shows the failed delivery and it can be redelivered from the
    // App's settings; nothing was recorded, so a redelivery is not a
    // duplicate.
    console.error(`Webhook delivery ${delivery} could not be recorded:`, error);
    return reply(500, { error: "The delivery could not be recorded." });
  }

  const { jobId } = recorded;
  if (jobId !== null) after(() => processAutomaticAnalysis(config, jobId));
  console.info(JSON.stringify({ event: "github_webhook", delivery, kind: plan.kind, outcome: recorded.outcome }));
  return reply(202, { outcome: recorded.outcome });
}
