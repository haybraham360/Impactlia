import { IngestionError } from "../ingestion/errors";
import type { ChangeType, PullRequestChanges, PullRequestFile } from "../impact/report";
import { HEADERS, REQUEST_TIMEOUT_MS, refusal, repositoryApi, request } from "./public-repository";
import type { RepositoryReference } from "./repository-url";

// Everything Impactlia asks GitHub about a pull request. Like the rest of
// lib/github, requests carry no token, so only pull requests of public
// repositories can be seen, and nothing about GitHub's responses leaves this
// file except the plain values below.
//
// Everything GitHub returns here was written by whoever opened the pull
// request. It is data: it is checked for shape, cut to length, and never
// treated as an instruction or as a path on this machine.

export type PullRequest = {
  number: number;
  title: string;
  authorLogin: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  // GitHub's own count of the files the pull request changes.
  changedFileCount: number;
  updatedAt: string;
};

export type PullRequestSummary = Omit<PullRequest, "changedFileCount">;

export const MAX_PULL_REQUEST_NUMBER = 2_147_483_647;
// GitHub returns at most this many of a pull request's files, 100 a page.
export const FILE_LIST_LIMIT = 3000;
const PAGE_SIZE = 100;
// How many open pull requests the picker offers. Any other one can still be
// analysed by its number.
export const PULL_REQUEST_LIST_LIMIT = 30;

const SHA = /^[0-9a-f]{40}$/;
const TITLE_LENGTH = 300;
const NAME_LENGTH = 255;
// GitHub's own limit on a path is far below this.
const PATH_LENGTH = 4096;

type Fields = Record<string, unknown>;

function fields(value: unknown, what: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`GitHub's ${what} was not an object.`);
  }
  return value as Fields;
}

function text(value: unknown, what: string, maxLength: number): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`GitHub's response is missing ${what}.`);
  }
  return value.slice(0, maxLength);
}

function count(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`GitHub's response is missing ${what}.`);
  }
  return value;
}

function commit(value: unknown, what: string): string {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new Error(`GitHub's response is missing ${what}.`);
  }
  return value;
}

function readSummary(value: unknown): PullRequestSummary {
  const body = fields(value, "pull request");
  const base = fields(body.base, "pull request base");
  const head = fields(body.head, "pull request head");
  // The author's account can be gone; GitHub then sends no user at all.
  const user = typeof body.user === "object" && body.user !== null ? (body.user as Fields) : null;
  return {
    number: count(body.number, "the pull request number"),
    title: text(body.title, "the pull request title", TITLE_LENGTH),
    authorLogin: user ? text(user.login, "the author's login", NAME_LENGTH) : "ghost",
    state:
      typeof body.merged_at === "string" ? "merged" : body.state === "closed" ? "closed" : "open",
    draft: body.draft === true,
    baseRef: text(base.ref, "the base branch", NAME_LENGTH),
    baseSha: commit(base.sha, "the base commit"),
    headRef: text(head.ref, "the head branch", NAME_LENGTH),
    headSha: commit(head.sha, "the head commit"),
    updatedAt: text(body.updated_at, "when the pull request was updated", 40),
  };
}

const label = ({ owner, name }: RepositoryReference) => `${owner}/${name}`;

// The pull request as GitHub has it right now.
export async function findPullRequest(
  repository: RepositoryReference,
  number: number,
): Promise<PullRequest> {
  const response = await request(
    `${repositoryApi(repository)}/pulls/${number}`,
    HEADERS.Accept,
    REQUEST_TIMEOUT_MS,
  );
  if (response.status === 404) {
    throw new IngestionError(
      `GitHub has no pull request #${number} in ${label(repository)}, or the repository is no longer public.`,
    );
  }
  if (!response.ok) throw refusal(response, repository);
  const body: unknown = await response.json();
  const summary = readSummary(body);
  if (summary.number !== number) {
    throw new Error(`GitHub answered for pull request #${summary.number}, not #${number}.`);
  }
  return {
    ...summary,
    changedFileCount: count(fields(body, "pull request").changed_files, "the changed file count"),
  };
}

// The open pull requests most recently updated. One request.
export async function listOpenPullRequests(
  repository: RepositoryReference,
): Promise<PullRequestSummary[]> {
  const response = await request(
    `${repositoryApi(repository)}/pulls?state=open&sort=updated&direction=desc&per_page=${PULL_REQUEST_LIST_LIMIT}`,
    HEADERS.Accept,
    REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) throw refusal(response, repository);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("GitHub's pull request list was not a list.");
  return body.map(readSummary);
}

// GitHub's statuses, as the four the analysis distinguishes. A copy is a new
// file; "changed" is GitHub's word for a change of mode or type.
const CHANGE_TYPES: Record<string, ChangeType> = {
  added: "added",
  copied: "added",
  modified: "modified",
  changed: "modified",
  renamed: "renamed",
  removed: "removed",
};

function readFile(value: unknown): PullRequestFile | null {
  const body = fields(value, "changed file");
  const status = text(body.status, "a changed file's status", 40);
  // Listed for completeness by some responses; it is not a change.
  if (status === "unchanged") return null;
  const changeType = CHANGE_TYPES[status];
  if (!changeType) throw new Error(`GitHub gave a changed file the unknown status "${status}".`);
  return {
    path: text(body.filename, "a changed file's path", PATH_LENGTH),
    changeType,
    previousPath:
      changeType === "renamed" && typeof body.previous_filename === "string"
        ? body.previous_filename.slice(0, PATH_LENGTH)
        : null,
    additions: count(body.additions, "a changed file's additions"),
    deletions: count(body.deletions, "a changed file's deletions"),
    // Only whether there is one. The analysis is per file, so the patch's
    // text is not kept.
    patchAvailable: typeof body.patch === "string",
  };
}

// Every file the pull request changes, up to GitHub's limit. `expected` is
// the pull request's own count, which decides how many pages to ask for and
// whether what came back is all of it.
export async function listPullRequestFiles(
  repository: RepositoryReference,
  number: number,
  expected: number,
): Promise<PullRequestChanges> {
  const pages = Math.ceil(Math.min(expected, FILE_LIST_LIMIT) / PAGE_SIZE);
  const files: PullRequestFile[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const response = await request(
      `${repositoryApi(repository)}/pulls/${number}/files?per_page=${PAGE_SIZE}&page=${page}`,
      HEADERS.Accept,
      REQUEST_TIMEOUT_MS,
    );
    if (response.status === 404) {
      throw new IngestionError(
        `GitHub no longer has pull request #${number} in ${label(repository)}, or the repository is no longer public.`,
      );
    }
    if (!response.ok) throw refusal(response, repository);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("GitHub's changed file list was not a list.");
    for (const entry of body) {
      const file = readFile(entry);
      if (file) files.push(file);
    }
    if (body.length < PAGE_SIZE) break;
  }
  return { files, complete: files.length === expected, reportedFileCount: expected };
}
