import Link from "next/link";
import { Suspense } from "react";
import { externalTracing } from "@/lib/ai/client";
import { MODEL, TASK_LABELS } from "@/lib/ai/config";
import { listRuns, type AiRun, type RunFilter } from "@/lib/ai/store";
import type { CacheStatus, Outcome } from "@/lib/ai/traced";
import { AI_RUNS_PATH, repositoryPath } from "@/lib/routes";
import { getWorkspace } from "@/lib/workspace";

const outcomes: Record<Outcome, { label: string; tone: string }> = {
  succeeded: { label: "Succeeded", tone: "" },
  "input-failed": { label: "Input failed", tone: "text-critical" },
  "model-failed": { label: "Model failed", tone: "text-critical" },
  rejected: { label: "Answer rejected", tone: "text-caution" },
};

const cacheStatuses: Record<CacheStatus, { label: string; tone: string }> = {
  hit: { label: "Hit", tone: "" },
  miss: { label: "Miss", tone: "" },
  "read-failed": { label: "Read failed", tone: "text-caution" },
  "write-failed": { label: "Write failed", tone: "text-caution" },
};

// Rendered on the server, which doesn't know the reader's time zone, so times
// are shown in UTC and say so.
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});
const numberFormat = new Intl.NumberFormat("en");

const isKey = <Key extends string>(record: Record<Key, unknown>, value: unknown): value is Key =>
  typeof value === "string" && value in record;

function hrefFor(filter: RunFilter): string {
  const query = new URLSearchParams();
  if (filter.outcome) query.set("outcome", filter.outcome);
  if (filter.cacheStatus) query.set("cache", filter.cacheStatus);
  const text = query.toString();
  return text ? `${AI_RUNS_PATH}?${text}` : AI_RUNS_PATH;
}

function FilterRow<Key extends string>({
  label,
  options,
  current,
  hrefOf,
}: {
  label: string;
  options: Record<Key, { label: string }>;
  current: Key | null;
  hrefOf: (value: Key | null) => string;
}) {
  const choices: [Key | null, string][] = [
    [null, "All"],
    ...(Object.keys(options) as Key[]).map((key): [Key, string] => [key, options[key].label]),
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <span className="w-16 text-muted">{label}</span>
      {choices.map(([value, text]) => (
        <Link
          key={value ?? "all"}
          href={hrefOf(value)}
          aria-current={current === value ? "true" : undefined}
          className="rounded-md px-2 py-0.5 text-muted hover:text-ink aria-[current=true]:bg-canvas aria-[current=true]:font-medium aria-[current=true]:text-ink"
        >
          {text}
        </Link>
      ))}
    </div>
  );
}

// Zero is a fact and is shown as one. Unknown is shown as unknown.
const tokens = (count: number | null) => (count === null ? "Unknown" : numberFormat.format(count));

function RunRow({ run }: { run: AiRun }) {
  const seconds = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000;
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-4 whitespace-nowrap">
        <time dateTime={run.startedAt}>{dateTimeFormat.format(new Date(run.startedAt))}</time>
        <div className="text-xs text-muted">{seconds.toFixed(1)} s</div>
      </td>
      <td className="py-2 pr-4">
        {TASK_LABELS[run.task]}
        <div className="font-mono text-xs break-all text-muted">
          {run.subject || "(repository root)"}
        </div>
        <Link href={repositoryPath(run.repository.id)} className="text-xs text-accent hover:underline">
          {run.repository.owner}/{run.repository.name}
        </Link>
      </td>
      <td className={`py-2 pr-4 ${outcomes[run.outcome].tone}`}>
        {outcomes[run.outcome].label}
        {run.errorSummary && (
          <div className="max-w-64 text-xs break-words text-muted">{run.errorSummary}</div>
        )}
      </td>
      <td className={`py-2 pr-4 whitespace-nowrap ${cacheStatuses[run.cacheStatus].tone}`}>
        {cacheStatuses[run.cacheStatus].label}
      </td>
      <td className="py-2 pr-4 whitespace-nowrap">
        {run.modelCalled ? "Called" : "Not called"}
        <div className="font-mono text-xs text-muted">{run.model}</div>
        <div className="text-xs text-muted">Prompt {run.promptVersion}</div>
      </td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {tokens(run.inputTokens)} in
        <div>{tokens(run.outputTokens)} out</div>
      </td>
      <td className="py-2 whitespace-nowrap">{run.externalTrace ? "Sent" : "Not sent"}</td>
    </tr>
  );
}

async function Runs({ searchParams }: { searchParams: PageProps<"/app/ai-runs">["searchParams"] }) {
  // Resolved first so a session without an organization is redirected before
  // anything is read.
  await getWorkspace();
  const { outcome, cache } = await searchParams;
  const filter: RunFilter = {
    outcome: isKey(outcomes, outcome) ? outcome : null,
    cacheStatus: isKey(cacheStatuses, cache) ? cache : null,
  };
  const runs = await listRuns(filter);

  return (
    <>
      {/* Read per request, not at build time: it reflects the running server. */}
      {!externalTracing && (
        <div className="mb-6 max-w-2xl border-l-2 border-caution pl-3 text-sm">
          <p className="font-medium text-caution">LangSmith tracing is not configured</p>
          <p className="mt-1 text-muted">
            Runs are still made and still recorded here, but none is being sent to LangSmith, so
            traces there are incomplete. Set LANGSMITH_API_KEY in .env.local and restart the
            server to send them.
          </p>
        </div>
      )}
      <div className="space-y-1 text-sm">
        <FilterRow
          label="Outcome"
          options={outcomes}
          current={filter.outcome}
          hrefOf={(value) => hrefFor({ ...filter, outcome: value })}
        />
        <FilterRow
          label="Cache"
          options={cacheStatuses}
          current={filter.cacheStatus}
          hrefOf={(value) => hrefFor({ ...filter, cacheStatus: value })}
        />
      </div>

      {runs.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          {filter.outcome || filter.cacheStatus
            ? "No runs match these filters."
            : "No AI runs yet. Open a repository, select a file and choose Explain."}
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="pr-4 pb-2 font-medium">Started (UTC)</th>
                <th className="pr-4 pb-2 font-medium">Request</th>
                <th className="pr-4 pb-2 font-medium">Outcome</th>
                <th className="pr-4 pb-2 font-medium">Cache</th>
                <th className="pr-4 pb-2 font-medium">Model</th>
                <th className="pr-4 pb-2 text-right font-medium">Tokens</th>
                <th className="pb-2 font-medium">LangSmith</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function AiRunsPage({ searchParams }: PageProps<"/app/ai-runs">) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight">AI runs</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Every explanation or role suggestion this organization has requested, newest first,
        including the ones the cache answered without calling a model. The pinned model is{" "}
        <span className="font-mono text-[0.8125rem] text-ink">{MODEL}</span>.
      </p>

      <div className="mt-8">
        <Suspense>
          <Runs searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
