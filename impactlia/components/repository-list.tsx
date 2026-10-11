import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { retryRun } from "@/lib/ingestion/actions";
import type { RepositoryEntry, RepositoryRun } from "@/lib/ingestion/runs";
import { STALE_AFTER_MS, stageOf } from "@/lib/ingestion/stages";
import { pullRequestsPath, repositoryPath, runPath } from "@/lib/routes";

const numberFormat = new Intl.NumberFormat("en");
// Rendered on the server, which doesn't know the reader's time zone, so times
// are shown in UTC and say so.
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

type State = "running" | "stale" | "completed" | "failed";

// The same marks as the analysis-run list, plus one for stale: a shape of its
// own, so it is never read as a run that is moving.
const states: Record<State, { label: string; mark: string; tone: string; pill: string }> = {
  running: {
    label: "Running",
    mark: "rounded-full border-[1.5px] border-current bg-linear-to-r from-current from-50% to-transparent to-50%",
    tone: "text-accent",
    pill: "border-accent/30 bg-accent/10",
  },
  stale: {
    label: "Stale",
    mark: "border-[1.5px] border-current",
    tone: "text-caution",
    pill: "border-caution/40 bg-caution/10",
  },
  completed: {
    label: "Completed",
    mark: "rounded-full bg-current",
    tone: "text-positive",
    pill: "border-positive/30 bg-positive/10",
  },
  failed: {
    label: "Failed",
    mark: "rotate-45 bg-current",
    tone: "text-critical",
    pill: "border-critical/30 bg-critical/10",
  },
};

const stateOf = (run: RepositoryRun): State => (run.stale ? "stale" : run.status);

function StatePill({ state }: { state: State }) {
  const { label, mark, tone, pill } = states[state];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${tone} ${pill}`}
    >
      <span aria-hidden="true" className={`size-2 shrink-0 ${mark}`} />
      {label}
    </span>
  );
}

function RunNote({ run, state }: { run: RepositoryRun; state: State }) {
  if (state === "running") {
    return <p className="mt-1 text-muted">{stageOf(run.stage).label}</p>;
  }
  if (state === "stale") {
    return (
      <p className="mt-1 text-muted">
        No progress recorded for over {STALE_AFTER_MS / 60_000} minutes. Last stage
        started: {stageOf(run.stage).label}.
      </p>
    );
  }
  if (state === "failed") {
    return (
      <p className="mt-2 border-l-2 border-critical pl-3 text-critical">
        Failed in “{stageOf(run.stage).label}”. {run.failureReason}
      </p>
    );
  }
  return (
    <p className="mt-1 text-muted">
      {numberFormat.format(run.fileCount ?? 0)} files,{" "}
      {numberFormat.format(run.edgeCount ?? 0)} dependencies,{" "}
      {numberFormat.format(run.unresolvedCount ?? 0)} unresolved imports
    </p>
  );
}

function Retry({ run, state }: { run: RepositoryRun; state: State }) {
  if (state !== "failed" && state !== "stale") return null;
  return (
    <form action={retryRun}>
      <input type="hidden" name="runId" value={run.id} />
      <SubmitButton quiet pendingLabel="Starting…">
        Retry
      </SubmitButton>
    </form>
  );
}

function Row({
  title,
  href,
  run,
  hasGraph,
  repositoryId,
}: {
  title: string;
  href: string | null;
  run: RepositoryRun;
  hasGraph: boolean;
  repositoryId: string | null;
}) {
  const state = stateOf(run);
  return (
    <li className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-line px-5 py-4 text-sm first:border-t-0">
      <div className="w-28 shrink-0">
        <StatePill state={state} />
      </div>
      <div className="min-w-0 flex-1 basis-72">
        <p className="font-mono text-[0.9375rem] font-medium break-all">
          {href ? (
            <Link href={href} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
        <RunNote run={run} state={state} />
        <p className="mt-1 text-xs text-muted">
          <time dateTime={run.createdAt}>
            Run started {dateTimeFormat.format(new Date(run.createdAt))} UTC
          </time>
          {run.sourceSha && (
            <>
              {" "}
              at commit <span className="font-mono">{run.sourceSha.slice(0, 7)}</span>
            </>
          )}
          {state !== "completed" && hasGraph && ". An earlier analysis is still stored."}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {hasGraph && repositoryId && (
          <Link
            href={repositoryPath(repositoryId)}
            className="rounded-md border border-line bg-surface px-3.5 py-2 font-medium hover:bg-canvas"
          >
            Open map
          </Link>
        )}
        {repositoryId && (
          <Link href={pullRequestsPath(repositoryId)} className="text-accent hover:underline">
            Pull requests
          </Link>
        )}
        {state !== "completed" && (
          <Link href={runPath(run.id)} className="text-accent hover:underline">
            {state === "running" ? "Watch progress" : "Run details"}
          </Link>
        )}
        <Retry run={run} state={state} />
      </div>
    </li>
  );
}

export function RepositoryList({
  repositories,
  failedSubmissions,
}: {
  repositories: RepositoryEntry[];
  failedSubmissions: RepositoryRun[];
}) {
  const withRuns = repositories.flatMap((repository) =>
    repository.latestRun ? [{ repository, run: repository.latestRun }] : [],
  );
  if (withRuns.length === 0 && failedSubmissions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-muted/60 px-5 py-4 text-sm text-muted">
        No repository has been analyzed yet. Enter a public GitHub repository above to
        build its dependency map.
      </p>
    );
  }

  return (
    <>
      {withRuns.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {withRuns.map(({ repository, run }) => (
            <Row
              key={repository.id}
              title={`${repository.owner}/${repository.name}`}
              href={repository.hasGraph ? repositoryPath(repository.id) : runPath(run.id)}
              run={run}
              hasGraph={repository.hasGraph}
              repositoryId={repository.id}
            />
          ))}
        </ul>
      )}
      {failedSubmissions.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-sm font-medium">Submissions that could not be validated</h3>
          <ul className="overflow-hidden rounded-lg border border-line bg-surface">
            {failedSubmissions.map((run) => (
              <Row
                key={run.id}
                title={run.requestedUrl}
                href={null}
                run={run}
                hasGraph={false}
                repositoryId={null}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
