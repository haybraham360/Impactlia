// The rules an automatic analysis follows, kept apart from the code that
// carries them out so each can be checked on its own in lib/automation/checks.

// Attempts in all, the first included. A job that still cannot finish after
// these is marked failed, with the last reason, and is not tried again.
export const MAX_ATTEMPTS = 4;

// Minutes to wait before the second, third and fourth attempt.
const BACKOFF_MINUTES = [1, 5, 15];
// However long GitHub asks for, a retry is scheduled no further out than
// this; the sweep will simply find it still limited and wait again.
const LONGEST_WAIT_MS = 60 * 60 * 1000;

// When the next attempt may start, or null when there is none left.
// `attempts` is how many have started, this one included. `retryAt` is when
// GitHub said to come back, if it did.
export function nextAttemptAt(attempts: number, retryAt: number | null, now: number): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const backoff = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? 1;
  const earliest = now + backoff * 60 * 1000;
  const asked = retryAt !== null && retryAt > earliest ? retryAt : earliest;
  return new Date(Math.min(asked, now + LONGEST_WAIT_MS));
}

export type PullRequestNow = { state: "open" | "closed" | "merged"; headSha: string };

// Whether a result for `headSha` may be published, given the pull request as
// GitHub has it now. Only the current head commit of an open pull request is
// ever published, so an older run can never present itself as the latest.
export function publicationOf(
  headSha: string,
  current: PullRequestNow,
): "publish" | "stale" | "closed" {
  if (current.state !== "open") return "closed";
  if (current.headSha !== headSha) return "stale";
  return "publish";
}
