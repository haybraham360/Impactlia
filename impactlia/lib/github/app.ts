import "server-only";
import crypto from "node:crypto";
import type { AutomationConfig } from "@/lib/env";
import { IngestionError } from "@/lib/ingestion/errors";
import { isManagedComment } from "./managed-comment";
import { API, HEADERS, REQUEST_TIMEOUT_MS, refusal, repositoryApi } from "./public-repository";
import type { RepositoryAccess, RepositoryReference } from "./repository-url";

// Everything Impactlia does as the Impactlia GitHub App: proving it is the
// App, getting an installation token for one repository, checking who can
// see an installation, and keeping one comment on a pull request up to date.
//
// Tokens live in memory for the length of one job or one request and are
// never stored or logged. Each installation token is limited to one
// repository and to the permissions below, whatever the installation has.

// What a job may do with its token, and no more.
const TOKEN_PERMISSIONS = { metadata: "read", contents: "read", pull_requests: "write" };
// Comments read when looking for Impactlia's own, 100 a page.
const COMMENT_PAGES = 10;
const INSTALLATION_PAGES = 10;
// GitHub refuses a comment longer than 65,536 characters.
export const COMMENT_LIMIT = 60_000;

// A problem trying again will not fix: the installation is gone, suspended,
// or does not allow what is needed. The message is written for the member.
export class GitHubAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAppError";
  }
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

// A JSON Web Token proving a request comes from the App. GitHub accepts at
// most ten minutes; the issue time is set a minute back for clock drift.
function appJwt(config: AutomationConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }));
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(config.privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

async function api(
  url: string,
  options: { method?: string; authorization?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...HEADERS };
  if (options.authorization) headers.Authorization = options.authorization;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A write is not repeated here: whether it reached GitHub is unknown.
    // The job's retry looks for the comment before writing again.
    const slow = error instanceof Error && error.name === "TimeoutError";
    throw new IngestionError(
      slow ? "GitHub took too long to answer. Try again in a moment." : "GitHub could not be reached. Try again in a moment.",
      { retryable: true },
    );
  }
}

type Fields = Record<string, unknown>;
async function json(response: Response): Promise<Fields> {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("GitHub's response was not an object.");
  }
  return body as Fields;
}

// ── Installations ──────────────────────────────────────────────────────────

// A token for one repository of one installation, valid for an hour.
export async function createInstallationToken(
  config: AutomationConfig,
  installationId: number,
  providerRepositoryId: string,
  repository: RepositoryReference,
): Promise<string> {
  const response = await api(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    authorization: `Bearer ${appJwt(config)}`,
    body: { repository_ids: [Number(providerRepositoryId)], permissions: TOKEN_PERMISSIONS },
  });
  if (response.status === 404) {
    throw new GitHubAppError(
      "The Impactlia GitHub App is no longer installed on this account. Connect GitHub again.",
    );
  }
  if (response.status === 403) {
    throw new GitHubAppError("The Impactlia GitHub App is suspended on this account.");
  }
  // The repository was removed from the installation, or the installation
  // has not accepted a permission the App asks for.
  if (response.status === 422) {
    throw new GitHubAppError(
      `The Impactlia GitHub App cannot read ${repository.owner}/${repository.name} or comment on its pull requests. Check the repository is selected in the installation and its permissions are accepted.`,
    );
  }
  if (!response.ok) throw refusal(response, repository);
  const { token } = await json(response);
  if (typeof token !== "string" || token === "") {
    throw new Error("GitHub's installation token response had no token.");
  }
  return token;
}

// Which installation of the App covers a repository, if any.
export async function findRepositoryInstallation(
  config: AutomationConfig,
  repository: RepositoryReference,
): Promise<number | null> {
  const response = await api(`${repositoryApi(repository)}/installation`, {
    authorization: `Bearer ${appJwt(config)}`,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw refusal(response, repository);
  const { id } = await json(response);
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("GitHub's installation response had no id.");
  }
  return id;
}

export type VisibleInstallation = { installationId: number; accountLogin: string };

// The account an installation is on, as GitHub has it now, or null when the
// installation does not exist (or was removed).
export async function findInstallationAccount(
  config: AutomationConfig,
  installationId: number,
): Promise<{ accountId: number; accountLogin: string; accountType: "User" | "Organization" } | null> {
  const response = await api(`${API}/app/installations/${installationId}`, {
    authorization: `Bearer ${appJwt(config)}`,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new IngestionError("GitHub did not describe the installation. Try again in a moment.", {
      retryable: true,
    });
  }
  const account = (await json(response)).account as Fields | null;
  if (
    typeof account?.id !== "number" ||
    typeof account.login !== "string" ||
    (account.type !== "User" && account.type !== "Organization")
  ) {
    throw new Error("GitHub's installation response had no account.");
  }
  return { accountId: account.id, accountLogin: account.login.slice(0, 100), accountType: account.type };
}

// GitHub sends the member back from installing the App with an installation
// id in the address, which anyone could edit. This is the check that the
// member really can see that installation: the one-time code is exchanged
// for the member's own GitHub token, the token lists the installations the
// member can access, and the token is revoked straight away.
//
// Returns null when the member cannot see it.
export async function confirmInstallationAccess(
  config: AutomationConfig,
  code: string,
  installationId: number,
): Promise<VisibleInstallation | null> {
  const exchange = await api("https://github.com/login/oauth/access_token", {
    method: "POST",
    body: { client_id: config.clientId, client_secret: config.clientSecret, code },
  });
  if (!exchange.ok) {
    throw new IngestionError("GitHub did not confirm the sign-in. Connect GitHub again.");
  }
  const { access_token: userToken } = await json(exchange);
  if (typeof userToken !== "string" || userToken === "") {
    throw new IngestionError("GitHub's sign-in code had expired. Connect GitHub again.");
  }

  try {
    for (let page = 1; page <= INSTALLATION_PAGES; page += 1) {
      const response = await api(`${API}/user/installations?per_page=100&page=${page}`, {
        authorization: `Bearer ${userToken}`,
      });
      if (!response.ok) {
        throw new IngestionError("GitHub did not list your installations. Connect GitHub again.");
      }
      const { installations } = await json(response);
      if (!Array.isArray(installations)) {
        throw new Error("GitHub's installation list was not a list.");
      }
      for (const entry of installations) {
        const installation = entry as Fields;
        const account = installation.account as Fields | null;
        if (installation.id === installationId && typeof account?.login === "string") {
          return { installationId, accountLogin: account.login.slice(0, 100) };
        }
      }
      if (installations.length < 100) break;
    }
    return null;
  } finally {
    // Only needed for the check above. Revoking it is best effort: it
    // expires on its own, and failing to revoke changes nothing here.
    await api(`${API}/applications/${encodeURIComponent(config.clientId)}/token`, {
      method: "DELETE",
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      body: { access_token: userToken },
    }).catch(() => undefined);
  }
}

// ── The pull request comment ───────────────────────────────────────────────

function commentRefusal(response: Response, repository: RepositoryAccess): Error {
  // Rate limits and GitHub's own errors are temporary; refusal says so.
  const temporary = refusal(response, repository);
  if (temporary.retryable) return temporary;
  if (response.status === 403 || response.status === 404 || response.status === 410) {
    return new GitHubAppError(
      "The analysis finished, but GitHub did not allow the comment. The pull request may be locked, or the Impactlia GitHub App lacks permission to write pull request comments.",
    );
  }
  return temporary;
}

// Impactlia's own comment on the pull request, if there is one. Only a
// comment written by this App's bot account and carrying the marker counts,
// so a comment by anyone else is never edited.
async function findManagedComment(
  config: AutomationConfig,
  repository: RepositoryAccess,
  number: number,
): Promise<number | null> {
  for (let page = 1; page <= COMMENT_PAGES; page += 1) {
    const response = await api(
      `${repositoryApi(repository)}/issues/${number}/comments?per_page=100&page=${page}`,
      { authorization: `Bearer ${repository.token}` },
    );
    if (!response.ok) throw commentRefusal(response, repository);
    const comments: unknown = await response.json();
    if (!Array.isArray(comments)) throw new Error("GitHub's comment list was not a list.");
    for (const comment of comments) {
      if (isManagedComment(comment, config.appSlug)) {
        const { id } = comment as Fields;
        if (typeof id === "number" && Number.isInteger(id) && id > 0) return id;
      }
    }
    if (comments.length < 100) break;
  }
  return null;
}

// Updates Impactlia's comment, or writes it if there is none. Returns its id.
export async function publishManagedComment(
  config: AutomationConfig,
  repository: RepositoryAccess,
  number: number,
  body: string,
): Promise<number> {
  if (!repository.token) throw new Error("Publishing a comment needs an installation token.");
  const authorization = `Bearer ${repository.token}`;
  const existing = await findManagedComment(config, repository, number);

  const response =
    existing !== null
      ? await api(`${repositoryApi(repository)}/issues/comments/${existing}`, {
          method: "PATCH",
          authorization,
          body: { body },
        })
      : await api(`${repositoryApi(repository)}/issues/${number}/comments`, {
          method: "POST",
          authorization,
          body: { body },
        });
  if (!response.ok) throw commentRefusal(response, repository);
  const { id } = await json(response);
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("GitHub's comment response had no id.");
  }
  return id;
}
