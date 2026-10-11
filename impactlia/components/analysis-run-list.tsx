import Link from "next/link";
import type { RiskLevel } from "@/lib/impact/report";
import type { AnalysisRun, AnalysisStatus } from "@/lib/impact/runs";
import { STALE_AFTER_MS, analysisStageOf } from "@/lib/impact/stages";
import { PULL_REQUESTS_PATH, analysisPath } from "@/lib/routes";

// What a row is shown as. Stale is not a stored status: it is an unfinished
// run that has recorded no progress for a while, and it gets a state of its
// own so it is never read as a run that is moving.
export type RunState = AnalysisStatus | "stale";

export const runStateOf = (run: { status: AnalysisStatus; stale: boolean }): RunState =>
  run.stale ? "stale" : run.status;

// Each state has its own mark shape as well as its own colour, so it still
// reads without colour.
const statuses: Record<
  RunState,
  { label: string; mark: string; tone: string; pill: string; noResult: string }
> = {
  pending: {
    label: "Pending",
    mark: "rounded-full border-[1.5px] border-current",
    tone: "text-muted",
    pill: "border-line",
    noResult: "Waiting to start",
  },
  running: {
    label: "Running",
    mark: "rounded-full border-[1.5px] border-current bg-linear-to-r from-current from-50% to-transparent to-50%",
    tone: "text-accent",
    pill: "border-accent/30 bg-accent/10",
    noResult: "In progress",
  },
  completed: {
    label: "Completed",
    mark: "rounded-full bg-current",
    tone: "text-positive",
    pill: "border-positive/30 bg-positive/10",
    noResult: "",
  },
  stale: {
    label: "Stale",
    mark: "border-[1.5px] border-current",
    tone: "text-caution",
    pill: "border-caution/40 bg-caution/10",
    noResult: "No result yet",
  },
  failed: {
    label: "Failed",
    mark: "rotate-45 bg-current",
    tone: "text-critical",
    pill: "border-critical/30 bg-critical/10",
    noResult: "No result",
  },
};

const statusOrder: RunState[] = ["completed", "running", "pending", "stale", "failed"];

// The level is the number of filled bars as well as the colour.
const risks: Record<RiskLevel, { label: string; bars: number; tone: string }> =
  {
    low: { label: "Low", bars: 1, tone: "text-positive" },
    medium: { label: "Medium", bars: 2, tone: "text-caution" },
    high: { label: "High", bars: 3, tone: "text-critical" },
  };

// Rendered on the server, which doesn't know the reader's time zone, so times
// are shown in UTC and say so.
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function StatusMark({ status }: { status: RunState }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 ${statuses[status].mark}`}
    />
  );
}

function NotAvailable() {
  return (
    <span className="text-muted">
      <span aria-hidden="true">–</span>
      <span className="sr-only">Not available</span>
    </span>
  );
}

// Changed is solid and affected is outlined, everywhere: a file the pull
// request touched is a fact, a file it could reach is a possibility.
export function StatePill({ state }: { state: RunState }) {
  const status = statuses[state];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${status.tone} ${status.pill}`}
    >
      <StatusMark status={state} />
      {status.label}
    </span>
  );
}

export function Impact({ changed, affected }: { changed: number; affected: number }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="min-w-7 rounded bg-ink px-1.5 py-0.5 text-center font-mono text-[0.8125rem] text-canvas tabular-nums">
        {changed}
      </span>
      <span>changed</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 28 8"
        className="h-2 w-7 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      >
        <path d="M0 4h26M22.5 1l3.5 3-3.5 3" />
      </svg>
      <span className="min-w-7 rounded border border-ink/60 px-1.5 py-0.5 text-center font-mono text-[0.8125rem] tabular-nums">
        {affected}
      </span>
      <span>could be affected</span>
    </span>
  );
}

export function Risk({ level }: { level: RiskLevel }) {
  const risk = risks[level];
  return (
    <span
      className={`inline-flex items-center gap-2 font-medium ${risk.tone}`}
    >
      <span aria-hidden="true" className="flex items-end gap-0.5">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={`h-3.5 w-1 rounded-sm bg-current ${
              bar > risk.bars ? "opacity-20" : ""
            }`}
          />
        ))}
      </span>
      {risk.label}
    </span>
  );
}

// A completed run with no level is not a missing value: the analysis ran and
// found nothing it could measure.
export function InsufficientEvidence() {
  return <span className="whitespace-nowrap text-muted">Insufficient evidence</span>;
}

function RunRow({ run }: { run: AnalysisRun }) {
  const state = runStateOf(run);
  const status = statuses[state];
  const requested = new Date(run.createdAt);

  return (
    <tr className="border-t border-line align-top">
      <td className="py-4 pr-6 pl-5 whitespace-nowrap">
        <StatePill state={state} />
      </td>
      <td className="max-w-md min-w-72 py-4 pr-6">
        <p className="text-[0.9375rem] leading-snug font-medium">
          <Link href={analysisPath(run.id)} className="hover:underline">
            {run.pullRequest.title}
          </Link>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
          <span className="font-mono text-[0.8125rem]">
            {run.repository.owner}/{run.repository.name}
            <span className="text-ink">#{run.pullRequest.number}</span>
          </span>
          <span>by {run.pullRequest.authorLogin}</span>
          <span>
            at <span className="font-mono text-[0.8125rem]">{run.headSha.slice(0, 7)}</span>
          </span>
        </p>
        {state === "running" && (
          <p className="mt-1 text-muted">{analysisStageOf(run.stage).label}</p>
        )}
        {state === "stale" && (
          <p className="mt-1 text-muted">
            No progress recorded for over {STALE_AFTER_MS / 60_000} minutes. Last stage started:{" "}
            {analysisStageOf(run.stage).label}.
          </p>
        )}
        {run.failureReason && (
          <p className="mt-2.5 border-l-2 border-critical pl-3 text-critical">
            Failed in “{analysisStageOf(run.stage).label}”. {run.failureReason}
          </p>
        )}
      </td>
      <td className="py-4 pr-6">
        {run.changedFileCount !== null && run.affectedFileCount !== null ? (
          <Impact
            changed={run.changedFileCount}
            affected={run.affectedFileCount}
          />
        ) : (
          <span className="whitespace-nowrap text-muted">
            {status.noResult}
          </span>
        )}
      </td>
      <td className="py-4 pr-6 whitespace-nowrap">
        {run.riskLevel ? (
          <Risk level={run.riskLevel} />
        ) : run.status === "completed" ? (
          <InsufficientEvidence />
        ) : (
          <NotAvailable />
        )}
      </td>
      <td className="py-4 pr-5 whitespace-nowrap">
        <time dateTime={run.createdAt}>
          {dateFormat.format(requested)}
          <span className="block text-muted">
            {timeFormat.format(requested)} UTC
          </span>
        </time>
      </td>
    </tr>
  );
}

// What an analysis consists of. A real sequence, so numbered.
const steps = [
  {
    title: "Add a repository",
    detail: "A public GitHub repository, in the section above.",
  },
  {
    title: "Select a pull request",
    detail: "Its changed files are matched against its head commit’s imports.",
  },
  {
    title: "Read the impact analysis",
    detail: "What the change could affect, and what to review or test.",
  },
];

function AnalyzeLink() {
  return (
    <Link
      href={PULL_REQUESTS_PATH}
      className="inline-block rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
    >
      Analyze a pull request
    </Link>
  );
}

function NoRuns() {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-6 py-6">
        <p className="text-base font-medium">
          No pull request has been analyzed yet
        </p>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Each analysis is listed here with its state, the files the pull
          request changed, the files it could affect and its risk level.
        </p>
        <p className="mt-4">
          <AnalyzeLink />
        </p>
      </div>
      <ol className="grid gap-6 px-6 py-6 text-sm sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line font-mono text-xs text-muted">
              {index + 1}
            </span>
            <span>
              <span className="block font-medium">{step.title}</span>
              <span className="block text-muted">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AnalysisRunList({ runs }: { runs: AnalysisRun[] }) {
  if (runs.length === 0) {
    return <NoRuns />;
  }

  // Counted from the rows shown below, so the two cannot disagree.
  const counts = statusOrder
    .map((status) => ({
      status,
      count: runs.filter((run) => runStateOf(run) === status).length,
    }))
    .filter((entry) => entry.count > 0);

  return (
    <>
      <p className="mb-4">
        <AnalyzeLink />
      </p>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <ul className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line px-5 py-3 text-sm">
          {counts.map(({ status, count }) => (
            <li
              key={status}
              className={`inline-flex items-center gap-2 ${statuses[status].tone}`}
            >
              <StatusMark status={status} />
              <span className="text-ink">
                <span className="font-medium tabular-nums">{count}</span>{" "}
                {statuses[status].label.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas/60 text-xs text-muted">
              <tr>
                <th scope="col" className="py-2.5 pr-6 pl-5 font-medium">
                  State
                </th>
                <th scope="col" className="py-2.5 pr-6 font-medium">
                  Pull request
                </th>
                <th scope="col" className="py-2.5 pr-6 font-medium">
                  Impact
                </th>
                <th scope="col" className="py-2.5 pr-6 font-medium">
                  Risk
                </th>
                <th scope="col" className="py-2.5 pr-5 font-medium">
                  Requested
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
