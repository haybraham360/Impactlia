import crypto from "node:crypto";

// What a GitHub webhook delivery asks Impactlia to do, decided from the
// verified payload alone. Pure: no network, no database, so every case is
// checked in lib/automation/checks.
//
// The payload was written by GitHub, but much of it describes things anyone
// with access to the repository controls (titles, branch names, bodies).
// Only ids, numbers, the head SHA and two flags are read here; nothing else
// from it is kept or followed.

const SIGNATURE = /^sha256=([0-9a-f]{64})$/;
const SHA = /^[0-9a-f]{40}$/;
// GitHub's X-GitHub-Delivery is a GUID.
const DELIVERY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// GitHub's ids fit comfortably in this; Postgres stores them as bigint.
const MAX_ID = Number.MAX_SAFE_INTEGER;
const MAX_PULL_REQUEST_NUMBER = 2_147_483_647;

// GitHub signs the exact bytes it sent with the webhook secret. The
// comparison takes the same time whatever the input, so it reveals nothing
// about the expected signature.
export function verifySignature(secret: string, body: string, header: string | null): boolean {
  if (!secret || header === null) return false;
  const match = SIGNATURE.exec(header.trim());
  if (!match) return false;
  const expected = crypto.createHmac("sha256", secret).update(body, "utf8").digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export const isDeliveryId = (value: string | null): value is string =>
  value !== null && DELIVERY.test(value);

export type PullRequestTarget = {
  installationId: number;
  // GitHub's repository id, as the repositories table stores it.
  providerRepositoryId: string;
  pullRequestNumber: number;
};

export type WebhookPlan =
  | { kind: "ignore"; reason: string }
  | { kind: "invalid"; reason: string }
  | (PullRequestTarget & { kind: "queue"; headSha: string; isPrivate: boolean })
  | (PullRequestTarget & { kind: "close" })
  | { kind: "installation"; installationId: number; action: InstallationAction };

export type InstallationAction = "deleted" | "suspend" | "unsuspend";

// Only these change what Impactlia does. Everything else GitHub sends is
// acknowledged and ignored.
const QUEUE_ACTIONS = new Set(["opened", "synchronize", "reopened"]);
const INSTALLATION_ACTIONS = new Set<string>(["deleted", "suspend", "unsuspend"]);

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
const id = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_ID
    ? value
    : null;

export function planWebhook(event: string, payload: unknown): WebhookPlan {
  const body = fields(payload);
  if (!body) return { kind: "invalid", reason: "The payload is not an object." };
  const action = typeof body.action === "string" ? body.action : null;

  if (event === "installation") {
    if (action === null || !INSTALLATION_ACTIONS.has(action)) {
      return { kind: "ignore", reason: `installation.${action ?? "?"} changes nothing here.` };
    }
    const installationId = id(fields(body.installation)?.id);
    if (installationId === null) {
      return { kind: "invalid", reason: "The installation has no valid id." };
    }
    return { kind: "installation", installationId, action: action as InstallationAction };
  }

  if (event !== "pull_request") {
    return { kind: "ignore", reason: `The ${event} event is not used.` };
  }
  if (action === null) return { kind: "invalid", reason: "The event has no action." };
  const queue = QUEUE_ACTIONS.has(action);
  if (!queue && action !== "closed") {
    return { kind: "ignore", reason: `pull_request.${action} changes nothing here.` };
  }

  const installationId = id(fields(body.installation)?.id);
  const repository = fields(body.repository);
  const repositoryId = id(repository?.id);
  const pullRequest = fields(body.pull_request);
  const number = pullRequest?.number;
  if (installationId === null) {
    return { kind: "invalid", reason: "The event has no valid installation id." };
  }
  if (repositoryId === null) {
    return { kind: "invalid", reason: "The event has no valid repository id." };
  }
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > MAX_PULL_REQUEST_NUMBER
  ) {
    return { kind: "invalid", reason: "The event has no valid pull request number." };
  }
  const target: PullRequestTarget = {
    installationId,
    providerRepositoryId: String(repositoryId),
    pullRequestNumber: number,
  };
  if (!queue) return { kind: "close", ...target };

  const headSha = fields(pullRequest?.head)?.sha;
  if (typeof headSha !== "string" || !SHA.test(headSha)) {
    return { kind: "invalid", reason: "The pull request has no valid head commit." };
  }
  if (typeof repository?.private !== "boolean") {
    return { kind: "invalid", reason: "The repository does not say whether it is private." };
  }
  return { kind: "queue", ...target, headSha, isPrivate: repository.private };
}
