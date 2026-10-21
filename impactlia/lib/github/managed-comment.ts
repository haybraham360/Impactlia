// How Impactlia recognises its own pull request comment. Pure, so the rule
// that no one else's comment is ever edited is checked in lib/automation/checks.

// The first line of every Impactlia comment. HTML comments are not shown on
// GitHub.
export const COMMENT_MARKER = "<!-- impactlia:pull-request-analysis -->";

// A comment is Impactlia's only when GitHub says the App's own bot account
// wrote it and it starts with the marker. A person can paste the marker, but
// cannot post as "<slug>[bot]": GitHub reserves those names for Apps.
export function isManagedComment(comment: unknown, appSlug: string): boolean {
  if (typeof comment !== "object" || comment === null) return false;
  const { user, body } = comment as Record<string, unknown>;
  if (typeof user !== "object" || user === null) return false;
  const { login, type } = user as Record<string, unknown>;
  return (
    type === "Bot" &&
    login === `${appSlug}[bot]` &&
    typeof body === "string" &&
    body.startsWith(COMMENT_MARKER)
  );
}
