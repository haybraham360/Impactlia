import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatePill, runStateOf } from "@/components/analysis-run-list";
import { ReanalyzeForm } from "@/components/analyze-forms";
import { PullRequestIcon } from "@/components/icons";
import { ImpactReport } from "@/components/impact-report";
import { RunProgress } from "@/components/run-progress";
import { findPullRequest, type PullRequest } from "@/lib/github/pull-request";
import { repositoryUrl } from "@/lib/github/repository-url";
import {
  getAnalysis,
  getStoredReport,
  type AnalysisRun,
  type StoredReport,
} from "@/lib/impact/runs";
import { ANALYSIS_STAGES, analysisTopic } from "@/lib/impact/stages";
import { IngestionError } from "@/lib/ingestion/errors";
import { WORKSPACE_PATH, analysisPath, pullRequestsPath } from "@/lib/routes";
import { getWorkspace } from "@/lib/workspace";

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function When({ at }: { at: string }) {
  return <time dateTime={at}>{dateTimeFormat.format(new Date(at))} UTC</time>;
}

function Commit({ run, sha }: { run: AnalysisRun; sha: string }) {
  return (
    <a
      href={`${repositoryUrl(run.repository)}/commit/${sha}`}
      className="font-mono text-[0.8125rem] leading-5 break-all hover:underline"
    >
      {sha}
    </a>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-prose border-l-2 border-caution pl-3 text-sm">{children}</p>;
}

// Whether the pull request has moved on since this run, asked of GitHub when
// the report is opened. Costs one request, so it is streamed in after the
// stored report rather than holding it up. When GitHub cannot be asked the
// page says freshness is unknown; it never assumes the report is current.
async function Freshness({ run }: { run: AnalysisRun }) {
  let current: PullRequest;
  try {
    current = await findPullRequest(run.repository, run.pullRequest.number);
  } catch (error) {
    if (!(error instanceof IngestionError)) {
      console.error("The pull request's current revision could not be checked:", error);
    }
    return (
      <Warning>
        <span className="font-medium">Freshness unknown.</span> GitHub could not be asked whether
        the pull request has changed since this run
        {error instanceof IngestionError ? `: ${error.message}` : "."}
      </Warning>
    );
  }
  if (current.headSha === run.headSha && current.baseSha === run.baseSha) return null;
  return (
    <Warning>
      <span className="font-medium text-caution">This report is of an earlier revision.</span>{" "}
      {current.headSha !== run.headSha
        ? `The pull request’s head is now ${current.headSha.slice(0, 7)}; this run analysed ${run.headSha.slice(0, 7)}.`
        : "The pull request’s base commit has changed since this run."}{" "}
      Re-analyze to cover its current commits.
    </Warning>
  );
}

async function Report({ run, pending }: { run: AnalysisRun; pending: Promise<StoredReport> }) {
  const report = await pending;
  return (
    <>
      {run.graphSha !== null && run.graphSha !== run.headSha && (
        <Warning>
          <span className="font-medium text-caution">Revision mismatch.</span> The graph was
          built from {run.graphSha.slice(0, 7)}, not the pull request’s head commit.
        </Warning>
      )}
      <ImpactReport run={run} report={report} />
      {report.otherRuns.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Other analyses of this pull request</h2>
          <ul className="panel mt-4 overflow-hidden text-sm">
            {report.otherRuns.map((other) => (
              <li key={other.id} className="border-t border-line first:border-t-0">
                <Link
                  href={analysisPath(other.id)}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors duration-150 hover:bg-hover"
                >
                  <span className="capitalize">{other.status}</span>
                  <span className="text-muted">
                    at <span className="font-mono text-[0.8125rem]">{other.headSha.slice(0, 7)}</span>
                  </span>
                  <span className="text-muted">
                    <When at={other.createdAt} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function Analysis({ params }: { params: Promise<{ analysisId: string }> }) {
  await getWorkspace();
  const { analysisId } = await params;
  // An analysis in another organization is not found, the same as one that
  // does not exist: the database returns neither.
  //
  // The report's rows are requested alongside the run rather than after it,
  // which saves a round trip to the database on every open. They are used
  // only for a completed run; for any other the read goes unused, so its
  // failure is caught here and surfaces only where it is awaited.
  const pendingRun = getAnalysis(analysisId);
  const pendingReport = getStoredReport(analysisId, pendingRun);
  pendingReport.catch(() => {});
  const run = await pendingRun;
  if (!run) notFound();
  const pullRequestUrl = `${repositoryUrl(run.repository)}/pull/${run.pullRequest.number}`;

  return (
    <>
      <header className="panel px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="flex max-w-3xl items-start gap-3 text-xl font-semibold tracking-tight sm:text-2xl">
            <PullRequestIcon className="mt-1.5 size-5 text-accent" />
            {run.pullRequest.title}
          </h1>
          <StatePill state={runStateOf(run)} />
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <Fact label="Pull request">
            <a href={pullRequestUrl} className="font-mono text-[0.8125rem] leading-5 break-all hover:underline">
              {run.repository.owner}/{run.repository.name}#{run.pullRequest.number}
            </a>
          </Fact>
          <Fact label="Author">{run.pullRequest.authorLogin}</Fact>
          <Fact label="Branches">
            <span className="font-mono text-[0.8125rem] leading-5 break-all">
              {run.pullRequest.baseRef} ← {run.pullRequest.headRef}
            </span>
          </Fact>
        </dl>
        <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <Fact label="Head commit analysed">
            <Commit run={run} sha={run.headSha} />
          </Fact>
          {run.baseSha && (
            <Fact label="Base commit">
              <Commit run={run} sha={run.baseSha} />
            </Fact>
          )}
        </dl>
        <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <Fact label="Requested">
            <When at={run.createdAt} />
          </Fact>
          {run.completedAt && (
            <Fact label={run.status === "failed" ? "Failed" : "Completed"}>
              <When at={run.completedAt} />
            </Fact>
          )}
          <Fact label="Analysis">
            <span className="font-mono text-[0.8125rem] leading-5 break-all">{run.id}</span>
          </Fact>
        </dl>
      </header>

      {run.status === "completed" ? (
        <>
          <div className="mt-4 flex flex-wrap items-start gap-3 text-sm">
            <ReanalyzeForm analysisId={run.id} quiet>
              Re-analyze
            </ReanalyzeForm>
            <a href={pullRequestUrl} className="btn btn-secondary btn-small">
              Open on GitHub
            </a>
            <Link href={pullRequestsPath(run.repository.id)} className="py-2 text-accent hover:underline">
              Other pull requests
            </Link>
          </div>
          <Suspense>
            <Freshness run={run} />
          </Suspense>
          <Report run={run} pending={pendingReport} />
        </>
      ) : (
        <div className="mt-6">
          <RunProgress
            initial={{
              id: run.id,
              // An analysis is created running; 'pending' is shown the same way.
              status: run.status === "pending" ? "running" : run.status,
              stage: run.stage,
              lastCompletedStage: run.lastCompletedStage,
              failureReason: run.failureReason,
              progressedAt: run.progressedAt,
            }}
            stages={ANALYSIS_STAGES}
            topic={analysisTopic(run.id)}
            completed={null}
            failedNote="Nothing was saved from this analysis. Earlier analyses of this pull request are unchanged."
            retry={<ReanalyzeForm analysisId={run.id}>Retry</ReanalyzeForm>}
            retryStale={
              <ReanalyzeForm analysisId={run.id}>Close this analysis and retry</ReanalyzeForm>
            }
          />
        </div>
      )}
    </>
  );
}

export default function AnalysisPage({ params }: PageProps<"/app/analyses/[analysisId]">) {
  return (
    <div className="enter mx-auto max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href={WORKSPACE_PATH} className="hover:text-ink">
          Overview
        </Link>{" "}
        <span aria-hidden="true">/</span> Pull request analysis
      </nav>
      <Suspense>
        <Analysis params={params} />
      </Suspense>
    </div>
  );
}
