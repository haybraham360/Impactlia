// The stages a repository run passes through, in order. The ids are the
// database's repository_run_stage values and never change; the wording is free
// to. Imported by server and browser code alike, so nothing here may depend on
// either.

export const STAGES = [
  {
    id: "validating",
    label: "Validating repository",
    message: "Checking the address and that GitHub has a public repository there.",
  },
  {
    id: "fetching",
    label: "Fetching source",
    message: "Finding the latest commit on the default branch.",
  },
  {
    id: "preparing",
    label: "Preparing files",
    message: "Loading the parsers for each supported language.",
  },
  {
    id: "parsing",
    label: "Parsing dependencies",
    message: "Downloading the commit, or only what changed since the stored analysis, and resolving every import to a file in the repository. Nothing in it is run.",
  },
  {
    id: "calculating",
    label: "Calculating graph data",
    message: "Checking the graph is consistent and working out its coverage.",
  },
  {
    id: "saving",
    label: "Saving analysis",
    message: "Storing the graph and the result of this run.",
  },
  {
    id: "complete",
    label: "Complete",
    message: "The stored analysis is ready to explore.",
  },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
export type RunStatus = "running" | "completed" | "failed";

export function stageOf(id: StageId): (typeof STAGES)[number] {
  const stage = STAGES.find((candidate) => candidate.id === id);
  if (!stage) throw new Error(`${id} is not a stage.`);
  return stage;
}

// A running run records progress at every stage change. One that has recorded
// none for this long is shown as stale. That is all stale means: the process
// may have stopped, or may still be working without having reported.
//
// The pipeline gives up on its own after PROCESSING_LIMIT_MS, so a run that is
// still running past that has almost certainly lost its process.
export const PROCESSING_LIMIT_MS = 4 * 60 * 1000;
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function isStale(
  run: { status: RunStatus; progressedAt: string },
  now: number,
): boolean {
  return run.status === "running" && now - Date.parse(run.progressedAt) > STALE_AFTER_MS;
}

export const runTopic = (runId: string) => `repository-run:${runId}`;
// The event both kinds of run broadcast their progress under.
export const RUN_PROGRESS_EVENT = "progress";
