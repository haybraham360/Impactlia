import Link from "next/link";
import { Suspense } from "react";
import { AnalyzeButton, AnalyzeNumberForm } from "@/components/analyze-forms";
import {
  PULL_REQUEST_LIST_LIMIT,
  listOpenPullRequests,
  type PullRequestSummary,
} from "@/lib/github/pull-request";
import { repositoryUrl } from "@/lib/github/repository-url";
import { getRepositoryIdentity, type RepositoryIdentity } from "@/lib/impact/runs";
import { IngestionError } from "@/lib/ingestion/errors";
import { listRepositories } from "@/lib/ingestion/runs";
import { PULL_REQUESTS_PATH, WORKSPACE_PATH, pullRequestsPath } from "@/lib/routes";
import { createSupabaseClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// Only repositories this organization has added are offered, and the database
// policy is what decides which those are.
async function ChooseRepository() {
  const repositories = await listRepositories();
  if (repositories.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-muted/60 px-5 py-4 text-sm text-muted">
        This organization has no repository yet.{" "}
        <Link href={WORKSPACE_PATH} className="text-accent hover:underline">
          Add a public GitHub repository on the overview
        </Link>
        , then come back to choose one of its pull requests.
      </p>
    );
  }
  return (
    <ul className="overflow-hidden rounded-lg border border-line bg-surface">
      {repositories.map((repository) => (
        <li key={repository.id} className="border-t border-line first:border-t-0">
          <Link
            href={pullRequestsPath(repository.id)}
            className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm hover:bg-canvas"
          >
            <span className="font-mono text-[0.9375rem] font-medium break-all">
              {repository.owner}/{repository.name}
            </span>
            <span className="shrink-0 text-accent">Choose a pull request</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PullRequestRows({
  repository,
  pullRequests,
}: {
  repository: RepositoryIdentity;
  pullRequests: PullRequestSummary[];
}) {
  if (pullRequests.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-muted/60 px-5 py-4 text-sm text-muted">
        GitHub lists no open pull requests for this repository. A closed or merged one can
        still be analyzed by its number.
      </p>
    );
  }
  return (
    <ul className="overflow-hidden rounded-lg border border-line bg-surface">
      {pullRequests.map((pullRequest) => (
        <li
          key={pullRequest.number}
          className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-line px-5 py-4 text-sm first:border-t-0"
        >
          <div className="min-w-0 flex-1 basis-72">
            <p className="text-[0.9375rem] leading-snug font-medium">
              {pullRequest.title}
              {pullRequest.draft && (
                <span className="ml-2 rounded border border-line px-1.5 text-xs font-normal text-muted">
                  Draft
                </span>
              )}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-muted">
              <a
                href={`${repositoryUrl(repository)}/pull/${pullRequest.number}`}
                className="font-mono text-[0.8125rem] text-ink hover:underline"
              >
                #{pullRequest.number}
              </a>
              <span>by {pullRequest.authorLogin}</span>
              <span className="font-mono text-[0.8125rem] break-all">
                {pullRequest.baseRef} ← {pullRequest.headRef}
              </span>
              <span>
                head <span className="font-mono text-[0.8125rem]">{pullRequest.headSha.slice(0, 7)}</span>
              </span>
              <time dateTime={pullRequest.updatedAt}>
                updated {dateFormat.format(new Date(pullRequest.updatedAt))}
              </time>
            </p>
          </div>
          <AnalyzeButton repositoryId={repository.id} pullRequestNumber={pullRequest.number} />
        </li>
      ))}
    </ul>
  );
}

async function OpenPullRequests({ repository }: { repository: RepositoryIdentity }) {
  let pullRequests: PullRequestSummary[];
  try {
    pullRequests = await listOpenPullRequests(repository);
  } catch (error) {
    if (!(error instanceof IngestionError)) {
      console.error("Open pull requests could not be listed:", error);
    }
    return (
      <div className="rounded-lg border border-critical/40 bg-surface px-5 py-4 text-sm">
        <p className="font-medium text-critical">The open pull requests could not be listed</p>
        <p className="mt-1">
          {error instanceof IngestionError
            ? error.message
            : "Something went wrong while asking GitHub. The details were logged on the server."}
        </p>
        <p className="mt-1 text-muted">
          Nothing is shown rather than an out-of-date list. A pull request can still be
          analyzed by its number, which asks GitHub again.
        </p>
      </div>
    );
  }
  return (
    <>
      <PullRequestRows repository={repository} pullRequests={pullRequests} />
      {pullRequests.length === PULL_REQUEST_LIST_LIMIT && (
        <p className="mt-2 text-sm text-muted">
          The {PULL_REQUEST_LIST_LIMIT} most recently updated open pull requests are listed.
          Any other can be analyzed by its number.
        </p>
      )}
    </>
  );
}

async function Picker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await getWorkspace();
  const { repository: requested } = await searchParams;
  if (typeof requested !== "string") {
    return (
      <>
        <h2 className="mb-3 text-lg font-semibold">Choose a repository</h2>
        <ChooseRepository />
      </>
    );
  }

  // A repository in another organization is not found, the same as one that
  // does not exist: the database returns neither.
  const repository = await getRepositoryIdentity(createSupabaseClient(), requested);
  if (!repository || repository.isSeed) {
    return (
      <>
        <p className="mb-6 border-l-2 border-critical pl-3 text-sm text-critical">
          That repository is not in this organization.
        </p>
        <h2 className="mb-3 text-lg font-semibold">Choose a repository</h2>
        <ChooseRepository />
      </>
    );
  }

  return (
    <>
      <p className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <a
          href={repositoryUrl(repository)}
          className="font-mono text-base font-medium break-all hover:underline"
        >
          {repository.owner}/{repository.name}
        </a>
        <Link href={PULL_REQUESTS_PATH} className="text-accent hover:underline">
          Choose another repository
        </Link>
      </p>
      <h2 className="mb-3 text-lg font-semibold">Open pull requests</h2>
      <Suspense fallback={<p className="text-sm text-muted">Asking GitHub…</p>}>
        <OpenPullRequests repository={repository} />
      </Suspense>
      <div className="mt-8">
        <AnalyzeNumberForm repositoryId={repository.id} />
      </div>
    </>
  );
}

export default function PullRequestsPage({ searchParams }: PageProps<"/app/pull-requests">) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight">Analyze a pull request</h1>
      <p className="mt-2 mb-8 max-w-prose text-sm text-muted">
        The pull request’s head commit is downloaded from GitHub and its imports are mapped,
        then the files it changes are followed to everything that imports them. Only public
        repositories are supported, and nothing in the repository is run.
      </p>
      <Suspense>
        <Picker searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
