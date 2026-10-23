import { HEADERS, REQUEST_TIMEOUT_MS, refusal, repositoryApi, request } from "./public-repository";
import type { RepositoryAccess } from "./repository-url";

// What changed between two commits, and single files at one commit: what the
// selective path (lib/ingestion/selective.ts) reads instead of a whole
// archive. Nothing about GitHub's responses leaves this file except the
// plain values below.

// GitHub's compare lists at most this many files, all on its first page.
export const COMPARE_FILE_LIMIT = 300;

export type ChangedPath = {
  path: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  // The path a renamed file had before.
  previousPath: string | null;
};

export type CommitComparison = {
  // How head relates to base. "ahead" and "identical" mean base is an
  // ancestor of head, so the files listed are everything that differs.
  status: "ahead" | "behind" | "identical" | "diverged";
  files: ChangedPath[];
  // False when GitHub listed its maximum, which may not be every file.
  complete: boolean;
};

const STATUSES = new Set<ChangedPath["status"]>(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]);
const RELATIONS = new Set<CommitComparison["status"]>(["ahead", "behind", "identical", "diverged"]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Every file that differs between two commits. One request: the files come
// with the first page, and one commit per page keeps it small.
export async function compareCommits(
  repository: RepositoryAccess,
  base: string,
  head: string,
): Promise<CommitComparison> {
  const response = await request(
    `${repositoryApi(repository)}/compare/${base}...${head}?per_page=1`,
    HEADERS.Accept,
    REQUEST_TIMEOUT_MS,
    repository.token,
  );
  if (!response.ok) throw refusal(response, repository);
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.status !== "string" || !Array.isArray(body.files)) {
    throw new Error("GitHub's comparison response was not in the expected shape.");
  }
  const relation = [...RELATIONS].find((candidate) => candidate === body.status);
  if (!relation) throw new Error(`GitHub's comparison has the unknown status ${body.status}.`);
  const files = body.files.map((entry: unknown): ChangedPath => {
    if (!isRecord(entry) || typeof entry.filename !== "string" || typeof entry.status !== "string") {
      throw new Error("GitHub's comparison listed a file in an unexpected shape.");
    }
    const status = [...STATUSES].find((candidate) => candidate === entry.status);
    if (!status) throw new Error(`GitHub's comparison has the unknown file status ${entry.status}.`);
    return {
      path: entry.filename,
      status,
      previousPath: typeof entry.previous_filename === "string" ? entry.previous_filename : null,
    };
  });
  return { status: relation, files, complete: files.length < COMPARE_FILE_LIMIT };
}

// One file at one commit, "missing" when it is not there, and "oversized"
// over `maxBytes` rather than cut short.
//
// Without a token the file comes from raw.githubusercontent.com, which does
// not count against the API's hourly limit of 60 requests; with one, from
// the contents API, which a private repository needs.
async function fetchOne(
  repository: RepositoryAccess,
  commitSha: string,
  filePath: string,
  maxBytes: number,
): Promise<Buffer | "missing" | "oversized"> {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const url = repository.token
    ? `${repositoryApi(repository)}/contents/${encoded}?ref=${commitSha}`
    : `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${commitSha}/${encoded}`;
  const response = await request(url, "application/vnd.github.raw+json", REQUEST_TIMEOUT_MS, repository.token);
  if (response.status === 404) {
    await response.body?.cancel();
    return "missing";
  }
  if (!response.ok) throw refusal(response, repository);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    return "oversized";
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length > maxBytes ? "oversized" : bytes;
}

// Several files at one commit, at most `concurrency` at a time. The first
// failure stops every request still to start, and is thrown.
export async function fetchFilesAtCommit(
  repository: RepositoryAccess,
  commitSha: string,
  paths: readonly string[],
  { maxBytes, concurrency }: { maxBytes: number; concurrency: number },
): Promise<Map<string, Buffer | "missing" | "oversized">> {
  const results = new Map<string, Buffer | "missing" | "oversized">();
  let next = 0;
  let failure: unknown = null;
  async function worker(): Promise<void> {
    while (failure === null && next < paths.length) {
      const filePath = paths[next];
      next += 1;
      try {
        results.set(filePath, await fetchOne(repository, commitSha, filePath, maxBytes));
      } catch (error) {
        failure ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  if (failure !== null) throw failure;
  return results;
}
