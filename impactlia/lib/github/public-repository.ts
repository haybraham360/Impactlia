import fs from "node:fs";
import { IngestionError } from "../ingestion/errors";
import type { RepositoryAccess, RepositoryReference } from "./repository-url";

// Everything Impactlia asks GitHub about a public repository. Requests a
// member starts carry no token, so they cannot see a private repository.
// Automatic analysis passes an installation token (RepositoryAccess) for the
// higher limit, and checks `isPrivate` itself. Nothing about GitHub's
// responses leaves this file except the plain values below.
//
// Unauthenticated requests share GitHub's limit of 60 an hour per server
// address. One repository analysis makes three, opening a repository makes
// one, each explanation that is not already cached makes one, listing a
// repository's pull requests makes one, and one pull request analysis makes
// five or more (lib/github/pull-request.ts).

export type PublicRepository = {
  // GitHub's own id, which survives a rename or a transfer.
  providerRepositoryId: string;
  // As GitHub spells them now, which may differ from what was typed.
  owner: string;
  name: string;
  defaultBranch: string;
  // Always false without a token: GitHub hides private repositories then.
  isPrivate: boolean;
};

export const API = "https://api.github.com";
export const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Impactlia",
};
export const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

// Every request is a read, so one that never connected is tried once more:
// on an unreliable network a single failed connection is common, and a
// second attempt usually gets through. A request that connected but did not
// finish in time is not repeated.
//
// A token goes only to api.github.com. A download redirects to another host,
// and fetch drops the Authorization header on a redirect to another origin.
export async function request(
  url: string,
  accept: string,
  timeout: number,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { ...HEADERS, Accept: accept };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new IngestionError("GitHub took too long to answer. Try again in a moment.", {
          retryable: true,
        });
      }
      if (attempt === 2) {
        throw new IngestionError("GitHub could not be reached. Try again in a moment.", {
          retryable: true,
        });
      }
    }
  }
}

// The reasons GitHub refuses that the person can do something about.
export function refusal(response: Response, repository: RepositoryAccess): IngestionError {
  const label = `${repository.owner}/${repository.name}`;
  if (
    (response.status === 403 || response.status === 429) &&
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const retryAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : null;
    const when = retryAt !== null
      ? ` Try again after ${timeFormat.format(new Date(retryAt))} UTC.`
      : " Try again later.";
    const whose = repository.token
      ? "GitHub's hourly request limit for the Impactlia GitHub App on this account"
      : "GitHub's hourly limit for requests without a sign-in";
    return new IngestionError(`${whose} has been reached.${when}`, { retryable: true, retryAt });
  }
  // GitHub's secondary limits, on bursts of requests, say how long to wait.
  const retryAfter = Number(response.headers.get("retry-after"));
  if ((response.status === 403 || response.status === 429) && retryAfter > 0) {
    return new IngestionError(
      "GitHub asked Impactlia to slow down. Try again in a few minutes.",
      { retryable: true, retryAt: Date.now() + retryAfter * 1000 },
    );
  }
  if (response.status >= 500) {
    return new IngestionError(
      `GitHub answered with an error (${response.status}) for ${label}. Try again in a moment.`,
      { retryable: true },
    );
  }
  if (response.status === 404) {
    return new IngestionError(
      `GitHub has no public repository at ${label}. Check the spelling. Private repositories are not supported yet.`,
    );
  }
  if (response.status === 409) {
    return new IngestionError(`${label} has no commits yet, so there is nothing to analyse.`);
  }
  if (response.status === 451 || response.status === 403) {
    return new IngestionError(`GitHub does not allow ${label} to be downloaded.`);
  }
  return new IngestionError(
    `GitHub answered with an error (${response.status}) for ${label}. Try again in a moment.`,
  );
}

export const repositoryApi = ({ owner, name }: RepositoryReference) =>
  `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

export async function findPublicRepository(
  reference: RepositoryAccess,
): Promise<PublicRepository> {
  const response = await request(
    repositoryApi(reference),
    HEADERS.Accept,
    REQUEST_TIMEOUT_MS,
    reference.token,
  );
  if (!response.ok) throw refusal(response, reference);

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) {
    throw new Error("GitHub's repository response was not an object.");
  }
  const { id, name, owner, default_branch: defaultBranch, private: hidden } =
    body as Record<string, unknown>;
  const login =
    typeof owner === "object" && owner !== null ? (owner as Record<string, unknown>).login : null;
  if (
    typeof id !== "number" ||
    typeof name !== "string" ||
    typeof login !== "string" ||
    typeof defaultBranch !== "string"
  ) {
    throw new Error("GitHub's repository response is missing its id, name, owner or default branch.");
  }
  // Without a token GitHub only ever answers for public repositories, so a
  // private one has already been refused above as not found.
  return {
    providerRepositoryId: String(id),
    owner: login,
    name,
    defaultBranch,
    isPrivate: hidden === true,
  };
}

// The commit the default branch points at right now.
export async function findHeadCommit(
  repository: RepositoryAccess & { defaultBranch: string },
): Promise<string> {
  const response = await request(
    `${repositoryApi(repository)}/commits/${encodeURIComponent(repository.defaultBranch)}`,
    "application/vnd.github.sha",
    REQUEST_TIMEOUT_MS,
    repository.token,
  );
  if (!response.ok) throw refusal(response, repository);
  const sha = (await response.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("GitHub's commit response was not a commit SHA.");
  }
  return sha;
}

// Downloads the archive of exactly one commit. Stops, and fails, as soon as
// the download passes `maxBytes`.
export async function downloadArchive(
  repository: RepositoryAccess,
  commitSha: string,
  file: string,
  maxBytes: number,
): Promise<void> {
  const response = await request(
    `${repositoryApi(repository)}/tarball/${commitSha}`,
    HEADERS.Accept,
    DOWNLOAD_TIMEOUT_MS,
    repository.token,
  );
  if (!response.ok) throw refusal(response, repository);
  if (!response.body) throw new Error("GitHub's archive response had no body.");

  const tooLarge = new IngestionError(
    `The repository's archive is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, which is over the limit for one analysis.`,
  );
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw tooLarge;
  }

  const reader = response.body.getReader();
  const descriptor = fs.openSync(file, "w", 0o600);
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) throw tooLarge;
      fs.writeSync(descriptor, value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof IngestionError) throw error;
    throw new IngestionError("The download from GitHub was interrupted. Try again in a moment.", {
      retryable: true,
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

// One file exactly as it was at one commit. Refuses a file over `maxBytes`
// rather than returning part of it, because the caller checks the bytes
// against a hash.
export async function fetchFileAtCommit(
  repository: RepositoryAccess,
  commitSha: string,
  filePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await request(
    `${repositoryApi(repository)}/contents/${encoded}?ref=${commitSha}`,
    "application/vnd.github.raw+json",
    REQUEST_TIMEOUT_MS,
    repository.token,
  );
  if (response.status === 404) {
    throw new IngestionError(
      `GitHub no longer has ${filePath} at commit ${commitSha.slice(0, 7)}, or the repository is no longer public.`,
    );
  }
  if (!response.ok) throw refusal(response, repository);
  const tooLarge = new IngestionError(
    `${filePath} is larger than ${Math.round(maxBytes / 1024)} KB, which is over the limit for reading one file.`,
  );
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw tooLarge;
  return bytes;
}
