import Link from "next/link";
import { Suspense } from "react";
import { AnalyzeButton, AnalyzeNumberForm } from "@/components/analyze-forms";
import { EmptyState } from "@/components/empty-state";
import { ArrowRightIcon, CheckIcon, PullRequestIcon, RepositoryIcon } from "@/components/icons";
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
      <EmptyState
        kind="repository"
        title="Your codebase journey starts here."
        action={
          <Link href={`${WORKSPACE_PATH}#add-repository`} className="btn btn-primary btn-small">
            <RepositoryIcon className="size-3.5" />
            Add a repository
          </Link>
        }
      >
        <p>
          This organization has no repository yet. Add a public GitHub repository on the
          overview, then come back to choose one of its pull requests.
        </p>
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {repositories.map((repository) => (
        <li key={repository.id}>
          <Link
            href={pullRequestsPath(repository.id)}
            className="panel lift group flex h-full items-center gap-3 px-4 py-3.5 text-sm"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-accent">
              <RepositoryIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[0.9375rem] font-medium break-all">
                {repository.owner}/{repository.name}
              </span>
              <span className="block text-xs text-muted">
                {repository.hasGraph ? "Dependency map stored" : "No dependency map stored yet"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-accent">
              <span className="hidden sm:inline">Choose</span>
              <ArrowRightIcon className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </span>
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
      <EmptyState kind="pull-request" title="No open pull requests">
        <p>
          GitHub lists no open pull requests for this repository. A closed or merged one can
          still be analyzed by its number, below.
        </p>
      </EmptyState>
    );
  }
  return (
    <ul className="panel overflow-hidden">
      {pullRequests.map((pullRequest) => (
        <li
          key={pullRequest.number}
          className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-t border-line px-5 py-4 text-sm transition-colors duration-150 first:border-t-0 hover:bg-hover"
        >
          <PullRequestIcon className="mt-1 hidden size-4 text-accent sm:block" />
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
      <div role="alert" className="panel border-critical/40 px-5 py-4 text-sm">
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

// Where this page is in the journey. A step is marked done only by what the
// address says has been chosen; nothing here guesses.
function Steps({ chosen }: { chosen: boolean }) {
  const steps = [
    { label: "Repository", done: chosen, current: !chosen },
    { label: "Pull request", done: false, current: chosen },
    { label: "Impact report", done: false, current: false },
  ];
  return (
    <ol aria-label="Steps" className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {steps.map((step, index) => (
        <li
          key={step.label}
          aria-current={step.current ? "step" : undefined}
          className="flex items-center gap-2"
        >
          {index > 0 && <span aria-hidden="true" className="h-px w-5 bg-line sm:w-8" />}
          <span
            className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
              step.current
                ? "border-accent/50 bg-accent/10 font-medium text-ink"
                : step.done
                  ? "border-line text-ink"
                  : "border-line text-muted"
            }`}
          >
            <span
              className={`flex size-4.5 items-center justify-center rounded-full text-[0.625rem] font-semibold ${
                step.done || step.current ? "bg-accent text-accent-ink" : "border border-line"
              }`}
            >
              {step.done ? <CheckIcon className="size-2.5" /> : index + 1}
            </span>
            {step.label}
            {step.done && <span className="sr-only">: chosen</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RowsFallback() {
  return (
    <div className="panel divide-y divide-line">
      <span className="sr-only">Asking GitHub…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-5 px-5 py-4">
          <div className="flex-1">
            <div aria-hidden="true" className="skeleton h-4 w-full max-w-md" />
            <div aria-hidden="true" className="skeleton mt-2 h-3 w-full max-w-xs" />
          </div>
          <div aria-hidden="true" className="skeleton h-8 w-20 rounded-lg" />
        </div>
      ))}
    </div>
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
        <Steps chosen={false} />
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
        <Steps chosen={false} />
        <p role="alert" className="mb-6 border-l-2 border-critical pl-3 text-sm text-critical">
          That repository is not in this organization.
        </p>
        <h2 className="mb-3 text-lg font-semibold">Choose a repository</h2>
        <ChooseRepository />
      </>
    );
  }

  return (
    <>
      <Steps chosen />
      <div className="panel mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-accent">
          <RepositoryIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted">Selected repository</span>
          <a
            href={repositoryUrl(repository)}
            className="font-mono text-base font-medium break-all hover:underline"
          >
            {repository.owner}/{repository.name}
          </a>
        </span>
        <Link href={PULL_REQUESTS_PATH} className="btn btn-secondary btn-small">
          Choose another repository
        </Link>
      </div>
      <h2 className="mb-3 text-lg font-semibold">Open pull requests</h2>
      <Suspense fallback={<RowsFallback />}>
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
    <div className="enter mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analyze a pull request</h1>
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
