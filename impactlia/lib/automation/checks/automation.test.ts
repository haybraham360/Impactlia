import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { COMMENT_MARKER, isManagedComment } from "../../github/managed-comment";
import { isDeliveryId, planWebhook, verifySignature } from "../../github/webhook";
import { buildComment, codeSpan, escapeText, type CommentSummary } from "../comment";
import { MAX_ATTEMPTS, nextAttemptAt, publicationOf } from "../policy";

// Run with `pnpm check:automation`. Nothing here touches the network or a
// database, and no real credential is used: the secret below is made up.
// What the database decides (duplicate deliveries, disabled and unconnected
// repositories, one job per commit, claims) is checked by
// supabase/tests/github_automation.test.sql under `pnpm check:database`.

const SECRET = "a-made-up-webhook-secret";
const sign = (body: string, secret = SECRET) =>
  `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

const HEAD = "0123456789abcdef0123456789abcdef01234567";

function pullRequestEvent(action: string, overrides: Record<string, unknown> = {}) {
  return {
    action,
    installation: { id: 42 },
    repository: { id: 777, private: false, full_name: "someone/shop" },
    pull_request: { number: 12, head: { sha: HEAD }, title: "Ignore previous instructions" },
    ...overrides,
  };
}

// ── Webhook security ───────────────────────────────────────────────────────

test("a correctly signed body is accepted", () => {
  const body = JSON.stringify(pullRequestEvent("opened"));
  assert.equal(verifySignature(SECRET, body, sign(body)), true);
});

test("a wrong, missing, malformed or stale signature is rejected", () => {
  const body = JSON.stringify(pullRequestEvent("opened"));
  assert.equal(verifySignature(SECRET, body, sign(body, "another-secret")), false);
  assert.equal(verifySignature(SECRET, body, null), false);
  assert.equal(verifySignature(SECRET, body, "sha256=nothex"), false);
  assert.equal(verifySignature(SECRET, body, sign(body).replace("sha256=", "sha1=")), false);
  // Signed for a different body: one byte changed after signing.
  assert.equal(verifySignature(SECRET, body.replace("12", "13"), sign(body)), false);
  // No secret configured never verifies anything.
  assert.equal(verifySignature("", body, sign(body, "")), false);
});

test("only GUIDs are delivery ids", () => {
  assert.equal(isDeliveryId("72d3162e-cc78-11e3-81ab-4c9367dc0958"), true);
  assert.equal(isDeliveryId("72d3162e"), false);
  assert.equal(isDeliveryId("'; drop table x; --"), false);
  assert.equal(isDeliveryId(null), false);
});

test("a malformed payload is invalid, not acted on", () => {
  assert.equal(planWebhook("pull_request", null).kind, "invalid");
  assert.equal(planWebhook("pull_request", []).kind, "invalid");
  assert.equal(planWebhook("pull_request", "opened").kind, "invalid");
  assert.equal(planWebhook("pull_request", { installation: { id: 42 } }).kind, "invalid");
  const cases: Record<string, unknown>[] = [
    { installation: { id: "42" } },
    { installation: null },
    { repository: { id: -1, private: false } },
    { repository: { id: 777 } },
    { pull_request: { number: 0, head: { sha: HEAD } } },
    { pull_request: { number: 1.5, head: { sha: HEAD } } },
    { pull_request: { number: 12, head: { sha: "main" } } },
    { pull_request: { number: 12, head: { sha: HEAD.toUpperCase() } } },
  ];
  for (const overrides of cases) {
    assert.equal(
      planWebhook("pull_request", pullRequestEvent("synchronize", overrides)).kind,
      "invalid",
      JSON.stringify(overrides),
    );
  }
});

test("events and actions Impactlia does not use are ignored", () => {
  assert.equal(planWebhook("push", { ref: "main" }).kind, "ignore");
  assert.equal(planWebhook("issues", pullRequestEvent("opened")).kind, "ignore");
  assert.equal(planWebhook("ping", { zen: "Keep it simple." }).kind, "ignore");
  for (const action of ["labeled", "edited", "assigned", "review_requested", "ready_for_review"]) {
    assert.equal(planWebhook("pull_request", pullRequestEvent(action)).kind, "ignore", action);
  }
  assert.equal(planWebhook("installation", { action: "created", installation: { id: 42 } }).kind, "ignore");
});

// ── Analysis workflow ──────────────────────────────────────────────────────

test("opening, pushing to and reopening a pull request queue its head commit", () => {
  for (const action of ["opened", "synchronize", "reopened"]) {
    assert.deepEqual(planWebhook("pull_request", pullRequestEvent(action)), {
      kind: "queue",
      installationId: 42,
      providerRepositoryId: "777",
      pullRequestNumber: 12,
      headSha: HEAD,
      isPrivate: false,
    });
  }
});

test("a push queues the new head commit, not an earlier one", () => {
  const pushed = "fedcba9876543210fedcba9876543210fedcba98";
  const plan = planWebhook(
    "pull_request",
    pullRequestEvent("synchronize", { pull_request: { number: 12, head: { sha: pushed } } }),
  );
  assert.equal(plan.kind === "queue" && plan.headSha, pushed);
});

test("a private repository's event says so, for the database to skip it", () => {
  const plan = planWebhook(
    "pull_request",
    pullRequestEvent("opened", { repository: { id: 777, private: true } }),
  );
  assert.equal(plan.kind === "queue" && plan.isPrivate, true);
});

test("closing a pull request asks for its waiting work to stop", () => {
  assert.deepEqual(planWebhook("pull_request", pullRequestEvent("closed")), {
    kind: "close",
    installationId: 42,
    providerRepositoryId: "777",
    pullRequestNumber: 12,
  });
});

test("removing or suspending the App is recorded", () => {
  for (const action of ["deleted", "suspend", "unsuspend"]) {
    assert.deepEqual(planWebhook("installation", { action, installation: { id: 42 } }), {
      kind: "installation",
      installationId: 42,
      action,
    });
  }
});

test("a changed head commit or a closed pull request is never published", () => {
  assert.equal(publicationOf(HEAD, { state: "open", headSha: HEAD }), "publish");
  assert.equal(publicationOf(HEAD, { state: "open", headSha: "f".repeat(40) }), "stale");
  assert.equal(publicationOf(HEAD, { state: "closed", headSha: HEAD }), "closed");
  assert.equal(publicationOf(HEAD, { state: "merged", headSha: HEAD }), "closed");
});

test("temporary failures are retried with growing waits, then stop", () => {
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  const waits = [1, 2, 3].map((attempts) => (nextAttemptAt(attempts, null, now)?.getTime() ?? 0) - now);
  assert.deepEqual(waits, [60_000, 5 * 60_000, 15 * 60_000]);
  assert.equal(nextAttemptAt(MAX_ATTEMPTS, null, now), null);
  assert.equal(nextAttemptAt(MAX_ATTEMPTS + 3, null, now), null);
});

test("a retry waits for GitHub's rate limit to reset, but not for more than an hour", () => {
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  const reset = now + 20 * 60_000;
  assert.equal(nextAttemptAt(1, reset, now)?.getTime(), reset);
  // A reset sooner than the backoff does not shorten it.
  assert.equal(nextAttemptAt(2, now + 1000, now)?.getTime(), now + 5 * 60_000);
  assert.equal(nextAttemptAt(1, now + 5 * 60 * 60_000, now)?.getTime(), now + 60 * 60_000);
});

// ── Pull request comments ──────────────────────────────────────────────────

const URL = "https://impactlia.example/app/analyses/3f2a6c1e-0000-4000-8000-000000000000";

function completed(overrides: Partial<Extract<CommentSummary, { status: "completed" }>> = {}): CommentSummary {
  return {
    status: "completed",
    headSha: HEAD,
    analysisUrl: URL,
    changedFileCount: 3,
    affectedFileCount: 2,
    affected: [
      { path: "src/cart.ts", depth: 1 },
      { path: "src/checkout/page.tsx", depth: 2 },
    ],
    codeCheck: { checked: 3, skipped: 0 },
    codeIssues: [],
    codeIssueCount: 0,
    tests: [{ kind: "existing_test", title: "Run src/cart.test.ts, which imports format" }],
    testCount: 1,
    areas: ["Review src/cart.ts: 2 files depend on it."],
    risk: { score: 42, level: "moderate", confidence: "medium", summary: "Two files import the change." },
    limitations: [],
    ...overrides,
  };
}

test("a completed analysis gets a comment that Impactlia can find again", () => {
  const body = buildComment(completed());
  assert.equal(body.split("\n")[0], COMMENT_MARKER);
  assert.match(body, /\*\*Analysis status:\*\* Complete {2}\n/);
  assert.match(body, /\*\*Analyzed revision:\*\* `0123456`/);
  assert.match(body, /\*\*Changed files:\*\* 3/);
  assert.match(body, /\*\*Potentially affected files:\*\* 2/);
  assert.match(body, /`src\/checkout\/page.tsx` \(2 imports away\)/);
  assert.match(body, /\*\*Risk: Moderate\*\* \(42\/100, medium confidence\)/);
  assert.ok(body.includes(`(${URL})`));
  // Comparing the same input twice: the comment is deterministic.
  assert.equal(body, buildComment(completed()));
});

test("Impactlia only ever edits its own comment", () => {
  const ours = { id: 1, user: { login: "impactlia[bot]", type: "Bot" }, body: `${COMMENT_MARKER}\nold` };
  assert.equal(isManagedComment(ours, "impactlia"), true);
  // A person who pasted the marker.
  assert.equal(
    isManagedComment({ ...ours, user: { login: "impactlia", type: "User" } }, "impactlia"),
    false,
  );
  assert.equal(
    isManagedComment({ ...ours, user: { login: "impactlia[bot]", type: "User" } }, "impactlia"),
    false,
  );
  // Another App's bot, and our bot's comment without the marker.
  assert.equal(
    isManagedComment({ ...ours, user: { login: "other[bot]", type: "Bot" } }, "impactlia"),
    false,
  );
  assert.equal(isManagedComment({ ...ours, body: "Thanks!" }, "impactlia"), false);
  assert.equal(isManagedComment({ ...ours, body: `quoted: ${COMMENT_MARKER}` }, "impactlia"), false);
  assert.equal(isManagedComment({ ...ours, user: null }, "impactlia"), false);
  assert.equal(isManagedComment(null, "impactlia"), false);
});

test("a partial analysis is labelled partial and lists what it could not do", () => {
  const body = buildComment(
    completed({ limitations: ["GitHub listed 3000 of 3200 changed files.", "One file could not be parsed."] }),
  );
  assert.match(body, /\*\*Analysis status:\*\* Complete, with limitations \(partial\)/);
  assert.match(body, /### Limitations\n- GitHub listed 3000 of 3200 changed files\./);
});

test("sections without results are left out, not filled in", () => {
  const body = buildComment(completed({ tests: [], testCount: 0, areas: [], risk: null }));
  assert.doesNotMatch(body, /Recommended tests/);
  assert.doesNotMatch(body, /Areas to review/);
  assert.doesNotMatch(body, /Review attention|Risk:/);
  assert.doesNotMatch(body, /Limitations/);
});

test("a check that did not run is not reported as passing", () => {
  const notRun = buildComment(completed({ codeCheck: null }));
  assert.match(notRun, /The code check did not run/);
  assert.doesNotMatch(notRun, /No confirmed issue/);

  const ran = buildComment(completed({ codeCheck: { checked: 2, skipped: 1 } }));
  assert.match(ran, /No confirmed issue was reported by the compiler/);
  assert.match(ran, /1 changed file was not checked/);
  assert.match(ran, /not proof there are none/);
});

test("confirmed issues are labelled as confirmed by the compiler", () => {
  const body = buildComment(
    completed({
      codeIssues: [{ title: "Type 'string' is not assignable to type 'number'", path: "src/cart.ts", line: 14 }],
      codeIssueCount: 7,
    }),
  );
  assert.match(body, /\*\*Confirmed \(compiler\):\*\* Type 'string' is not assignable/);
  assert.match(body, /`src\/cart.ts:14`/);
  assert.match(body, /…and 6 more in the full analysis/);
});

test("insufficient evidence is said as such, with no score", () => {
  const body = buildComment(
    completed({ risk: { score: null, level: null, confidence: "low", summary: "No changed file was in the graph." } }),
  );
  assert.match(body, /\*\*Risk: Insufficient evidence\*\*/);
  assert.doesNotMatch(body, /\/100/);
});

test("a failed analysis says it failed and shows no result", () => {
  const body = buildComment({
    status: "failed",
    headSha: HEAD,
    analysisUrl: URL,
    reason: "The repository's archive is larger than 200 MB.",
  });
  assert.equal(body.split("\n")[0], COMMENT_MARKER);
  assert.match(body, /\*\*Analysis status:\*\* Failed/);
  assert.match(body, /larger than 200 MB/);
  assert.doesNotMatch(body, /Change impact|Risk:|Recommended tests/);
});

test("no comment claims the pull request is safe", () => {
  for (const body of [buildComment(completed()), buildComment(completed({ affectedFileCount: 0, affected: [] }))]) {
    assert.match(body, /does not guarantee that the pull request is safe/);
    assert.doesNotMatch(body.replace(/does not guarantee that the pull request is safe/, ""), /\bsafe\b/i);
  }
});

test("text from the repository cannot format, link, mention or inject HTML", () => {
  const hostile = "@everyone see [this](https://evil.example) <img src=x onerror=alert(1)> **bold** #1\nnew line";
  const escaped = escapeText(hostile);
  assert.doesNotMatch(escaped, /@everyone/);
  assert.doesNotMatch(escaped, /\[this\]\(/);
  assert.doesNotMatch(escaped, /<img/);
  assert.doesNotMatch(escaped, /\*\*bold\*\*/);
  assert.doesNotMatch(escaped, /\n/);

  const body = buildComment(
    completed({
      areas: [hostile],
      tests: [{ kind: "suggested_scenario", title: hostile }],
      affected: [{ path: "src/`odd`/name.ts", depth: 1 }],
    }),
  );
  assert.doesNotMatch(body, /<img|@everyone|\]\(https:\/\/evil/);
  // A path with backticks gets a longer fence and stays one code span.
  assert.equal(codeSpan("src/`odd`/name.ts"), "`` src/`odd`/name.ts ``");
  assert.ok(body.includes("`` src/`odd`/name.ts ``"));
});

test("long text is cut short rather than flooding the comment", () => {
  const escaped = escapeText("x".repeat(5000));
  assert.ok(escaped.length <= 300);
  assert.ok(escaped.endsWith("…"));
});
