"use client";

import { useSession } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RUN_PROGRESS_EVENT, STALE_AFTER_MS } from "@/lib/ingestion/stages";
import { WORKSPACE_PATH } from "@/lib/routes";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

// Live progress of anything that runs in stages and reports them the same
// way: a repository run and a pull request analysis. Which stages, which
// topic and what can be done next are given by the page; this only shows
// what was persisted and what the topic then says.

export type ProgressStage = { id: string; label: string; message: string };

// What the server read, and what a topic carries: the database trigger builds
// exactly this and nothing else.
export type Progress = {
  id: string;
  status: "running" | "completed" | "failed";
  stage: string;
  lastCompletedStage: string | null;
  failureReason: string | null;
  progressedAt: string;
};

type Connection = "connecting" | "live" | "unavailable";
type StageState = "done" | "current" | "failed" | "waiting";

// The message comes from a database trigger, but it is still checked before
// it is believed.
function readProgress(
  payload: unknown,
  runId: string,
  stageIds: readonly string[],
): Progress | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  const isStage = (stage: unknown): stage is string =>
    typeof stage === "string" && stageIds.includes(stage);
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

function stateOf(
  stage: string,
  progress: Progress,
  stageIds: readonly string[],
): StageState {
  if (progress.status === "completed") return "done";
  const position = stageIds.indexOf(stage);
  const current = stageIds.indexOf(progress.stage);
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
  stages,
  topic,
  completed,
  failedNote,
  retry,
  retryStale,
  links,
}: {
  // The run as the server read it when the page was rendered.
  initial: Progress;
  stages: readonly ProgressStage[];
  // The run's private Realtime Broadcast topic.
  topic: string;
  // Where a completed run's result is opened. null when the result is this
  // same page, which is then read again from the server.
  completed: { href: string; label: string } | null;
  // What a failed run left behind.
  failedNote: string;
  // The forms that start a new run, after a failure and from a stale run.
  retry: ReactNode;
  retryStale: ReactNode;
  // Anything else worth offering beside them.
  links?: ReactNode;
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
  const stale = running && now - Date.parse(progress.progressedAt) > STALE_AFTER_MS;
  const stageIds = stages.map((stage) => stage.id);
  // Read through a ref so the subscription below is not restarted by a new
  // array or object with the same contents.
  const latest = useRef({ stageIds, completedHref: completed?.href ?? null });
  useEffect(() => {
    latest.current = { stageIds, completedHref: completed?.href ?? null };
  });

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
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event: RUN_PROGRESS_EVENT }, ({ payload }) => {
        const next = readProgress(payload, runId, latest.current.stageIds);
        if (!next) return;
        setLive(next);
        if (next.status === "completed") {
          const { completedHref } = latest.current;
          if (completedHref) router.push(completedHref);
          else router.refresh();
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
  }, [runId, topic, startedFinished, signedIn, router]);

  // Staleness is about time passing with no message, so nothing arrives to
  // announce it. One timer, set for the moment the current stage would become
  // stale, re-reads the clock then.
  useEffect(() => {
    if (!running) return;
    const due = Date.parse(progress.progressedAt) + STALE_AFTER_MS + 1000 - Date.now();
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(due, 0));
    return () => window.clearTimeout(timer);
  }, [running, progress.progressedAt]);

  const stage = stages.find((entry) => entry.id === progress.stage) ?? {
    id: progress.stage,
    label: progress.stage,
    message: "",
  };

  return (
    <div className="max-w-2xl">
      <div
        role="status"
        className={`panel px-5 py-4 ${
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
            <p className="mt-1 text-sm text-muted">{failedNote}</p>
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
          {progress.status === "completed" && completed && (
            <Link href={completed.href} className="btn btn-primary btn-small">
              {completed.label}
            </Link>
          )}
          {progress.status === "failed" && retry}
          {stale && retryStale}
          {progress.status === "failed" && links}
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

      {/* How far along the stored stages say the run is. Moves only when a
          stage is persisted; there is no timer behind it. */}
      <div className="mt-6 flex items-center gap-3 text-xs text-muted">
        <span className="tabular-nums">
          {progress.status === "completed"
            ? `All ${stages.length} stages done`
            : `Stage ${Math.max(stageIds.indexOf(progress.stage), 0) + 1} of ${stages.length}`}
        </span>
        <span aria-hidden="true" className="flex h-1 flex-1 gap-0.5">
          {stages.map((entry) => {
            const state = stateOf(entry.id, progress, stageIds);
            return (
              <span
                key={entry.id}
                className={`flex-1 rounded-full transition-colors duration-500 ${
                  state === "done"
                    ? "bg-positive"
                    : state === "current"
                      ? "bg-accent"
                      : state === "failed"
                        ? "bg-critical"
                        : "bg-line"
                }`}
              />
            );
          })}
        </span>
      </div>

      <ol className="mt-5">
        {stages.map((entry, index) => {
          const state = stateOf(entry.id, progress, stageIds);
          const mark = marks[state];
          const last = index === stages.length - 1;
          return (
            <li
              key={entry.id}
              aria-current={state === "current" ? "step" : undefined}
              className="relative flex gap-3 pb-4 text-sm last:pb-0"
            >
              {/* The rail joining this stage to the next, filled once passed. */}
              {!last && (
                <span
                  aria-hidden="true"
                  className={`absolute top-5 bottom-0.5 left-10 w-px transition-colors duration-500 ${
                    state === "done" ? "bg-positive/60" : "bg-line"
                  }`}
                />
              )}
              <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-xs text-muted">
                {index + 1}
              </span>
              <span
                aria-hidden="true"
                className={`relative mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${mark.tone} ${
                  state === "current" && !stale ? "live-ring" : ""
                }`}
              >
                <span className={`size-2 ${mark.mark}`} />
              </span>
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
