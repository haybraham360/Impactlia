"use client";

import { useSession } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { retryRun } from "@/lib/ingestion/actions";
import {
  RUN_PROGRESS_EVENT,
  STAGES,
  STALE_AFTER_MS,
  isStale,
  runTopic,
  stageOf,
  type RunProgress as Progress,
  type StageId,
} from "@/lib/ingestion/stages";
import { WORKSPACE_PATH, repositoryPath } from "@/lib/routes";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Connection = "connecting" | "live" | "unavailable";
type StageState = "done" | "current" | "failed" | "waiting";

const STAGE_IDS: readonly StageId[] = STAGES.map((stage) => stage.id);

// The message comes from a database trigger, but it is still checked before
// it is believed.
function readProgress(payload: unknown, runId: string): Progress | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  const isStage = (stage: unknown): stage is StageId =>
    typeof stage === "string" && STAGE_IDS.some((id) => id === stage);
  if (
    value.id !== runId ||
    (value.status !== "running" && value.status !== "completed" && value.status !== "failed") ||
    !isStage(value.stage) ||
    !(value.lastCompletedStage === null || isStage(value.lastCompletedStage)) ||
    !(value.failureReason === null || typeof value.failureReason === "string") ||
    typeof value.progressedAt !== "string"
  ) {
    return null;
  }
  return {
    id: runId,
    status: value.status,
    stage: value.stage,
    lastCompletedStage: value.lastCompletedStage,
    failureReason: value.failureReason,
    progressedAt: value.progressedAt,
  };
}

function stateOf(stage: StageId, progress: Progress): StageState {
  if (progress.status === "completed") return "done";
  const position = STAGE_IDS.indexOf(stage);
  const current = STAGE_IDS.indexOf(progress.stage);
  if (position < current) return "done";
  if (position > current) return "waiting";
  return progress.status === "failed" ? "failed" : "current";
}

// Shape as well as colour, the same marks the run lists use.
const marks: Record<StageState, { mark: string; tone: string; label: string }> = {
  done: { mark: "rounded-full bg-current", tone: "text-positive", label: "Done" },
  current: {
    mark: "rounded-full border-[1.5px] border-current bg-linear-to-r from-current from-50% to-transparent to-50%",
    tone: "text-accent",
    label: "In progress",
  },
  failed: { mark: "rotate-45 bg-current", tone: "text-critical", label: "Failed here" },
  waiting: { mark: "rounded-full border-[1.5px] border-current", tone: "text-muted", label: "Not started" },
};

export function RunProgress({
  initial,
  repositoryId,
  hasGraph,
}: {
  // The run as the server read it when the page was rendered.
  initial: Progress;
  repositoryId: string | null;
  // Whether an earlier run left a stored analysis that can still be opened.
  hasGraph: boolean;
}) {
  const router = useRouter();
  const { session } = useSession();
  const signedIn = Boolean(session);
  // The effect below must not restart whenever Clerk hands out a new session
  // object, so it reads the latest one through this.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [live, setLive] = useState<Progress | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [now, setNow] = useState(() => Date.now());

  // Whichever is newer: what the server rendered or what arrived since.
  const progress =
    live && Date.parse(live.progressedAt) >= Date.parse(initial.progressedAt) ? live : initial;
  const running = progress.status === "running";
  const stale = isStale(progress, now);

  const runId = initial.id;
  const startedFinished = initial.status !== "running";

  useEffect(() => {
    // A finished run never changes, so there is nothing to listen for.
    if (startedFinished || !signedIn) return;

    const client = createBrowserSupabaseClient(
      async () => (await sessionRef.current?.getToken()) ?? null,
    );
    let closed = false;
    const channel = client
      .channel(runTopic(runId), { config: { private: true } })
      .on("broadcast", { event: RUN_PROGRESS_EVENT }, ({ payload }) => {
        const next = readProgress(payload, runId);
        if (!next) return;
        setLive(next);
        if (next.status === "completed" && repositoryId) {
          router.push(repositoryPath(repositoryId));
        }
      });

    // A private topic is only joined with the token already in place.
    client.realtime
      .setAuth()
      .then(() => {
        if (closed) return;
        channel.subscribe((status) => {
          if (closed) return;
          if (status === "SUBSCRIBED") {
            setConnection("live");
            // Anything that happened between the server reading the run and
            // this subscription starting was not broadcast to us. One read
            // closes that gap; it is not repeated.
            router.refresh();
          } else {
            setConnection("unavailable");
          }
        });
      })
      .catch(() => {
        if (!closed) setConnection("unavailable");
      });

    return () => {
      closed = true;
      void client.removeChannel(channel);
      client.realtime.disconnect();
    };
  }, [runId, repositoryId, startedFinished, signedIn, router]);

  // Staleness is about time passing with no message, so nothing arrives to
  // announce it. One timer, set for the moment the current stage would become
  // stale, re-reads the clock then.
  useEffect(() => {
    if (!running) return;
    const due = Date.parse(progress.progressedAt) + STALE_AFTER_MS + 1000 - Date.now();
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(due, 0));
    return () => window.clearTimeout(timer);
  }, [running, progress.progressedAt]);

  const stage = stageOf(progress.stage);

  return (
    <div className="max-w-2xl">
      <div
        role="status"
        className={`rounded-lg border bg-surface px-5 py-4 ${
          progress.status === "failed"
            ? "border-critical/40"
            : stale
              ? "border-caution/50"
              : "border-line"
        }`}
      >
        {progress.status === "completed" && (
          <>
            <p className="font-medium text-positive">Analysis complete</p>
            <p className="mt-1 text-sm text-muted">{stage.message}</p>
          </>
        )}
        {progress.status === "failed" && (
          <>
            <p className="font-medium text-critical">Failed in “{stage.label}”</p>
            <p className="mt-1 text-sm">{progress.failureReason}</p>
            <p className="mt-1 text-sm text-muted">
              {hasGraph
                ? "Nothing was saved from this run. The analysis stored by an earlier run is unchanged."
                : "Nothing was saved from this run."}
            </p>
          </>
        )}
        {running && !stale && (
          <>
            <p className="font-medium">{stage.label}</p>
            <p className="mt-1 text-sm text-muted">{stage.message}</p>
          </>
        )}
        {running && stale && (
          <>
            <p className="font-medium text-caution">
              Stale: no progress recorded for over {STALE_AFTER_MS / 60_000} minutes
            </p>
            <p className="mt-1 text-sm">
              The last stage this run reported starting was “{stage.label}”. Runs stop
              themselves well before this, so it has most likely lost its process, but
              that cannot be confirmed from here. Retrying closes this run and starts a
              new one.
            </p>
          </>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {progress.status === "completed" && repositoryId && (
            <Link
              href={repositoryPath(repositoryId)}
              className="rounded-md bg-accent px-3.5 py-2 font-medium text-accent-ink"
            >
              Open the dependency map
            </Link>
          )}
          {(progress.status === "failed" || stale) && (
            <form action={retryRun}>
              <input type="hidden" name="runId" value={runId} />
              <SubmitButton pendingLabel="Starting a new run…">
                {stale ? "Close this run and retry" : "Retry"}
              </SubmitButton>
            </form>
          )}
          {progress.status === "failed" && hasGraph && repositoryId && (
            <Link href={repositoryPath(repositoryId)} className="text-accent hover:underline">
              Open the earlier analysis
            </Link>
          )}
          {progress.status !== "completed" && (
            <Link href={WORKSPACE_PATH} className="text-muted hover:text-ink">
              Back to overview
            </Link>
          )}
        </div>
      </div>

      {running && connection !== "live" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-muted/60 px-4 py-3 text-sm">
          {connection === "connecting" ? (
            <p className="text-muted">Connecting to live updates…</p>
          ) : (
            <>
              <p>
                <span className="font-medium">Live updates are unavailable.</span>{" "}
                <span className="text-muted">
                  The run is not affected, but this page will not change on its own.
                </span>
              </p>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="cursor-pointer text-accent hover:underline"
              >
                Check progress now
              </button>
            </>
          )}
        </div>
      )}

      <ol className="mt-6 space-y-3">
        {STAGES.map((entry, index) => {
          const state = stateOf(entry.id, progress);
          const mark = marks[state];
          return (
            <li
              key={entry.id}
              aria-current={state === "current" ? "step" : undefined}
              className="flex gap-3 text-sm"
            >
              <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-xs text-muted">
                {index + 1}
              </span>
              <span className={`mt-1.5 size-2 shrink-0 ${mark.mark} ${mark.tone}`} aria-hidden="true" />
              <span className={state === "waiting" ? "text-muted" : ""}>
                <span className={state === "current" || state === "failed" ? "font-medium" : ""}>
                  {entry.label}
                </span>
                <span className="sr-only">: {mark.label}</span>
                {state === "failed" && (
                  <span className="ml-2 text-xs text-critical">Failed here</span>
                )}
                {(state === "current" || state === "failed") && (
                  <span className="block text-muted">{entry.message}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
