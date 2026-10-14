import { PROCESSING_LIMIT_MS, STALE_AFTER_MS } from "../ingestion/stages";

// The stages a pull request analysis passes through, in order. The ids are the
// database's analysis_stage values and never change; the wording is free to.
// Imported by server and browser code alike, so nothing here may depend on
// either.

export const ANALYSIS_STAGES = [
  {
    id: "validating",
    label: "Validating access",
    message: "Checking with GitHub that the repository is public and the pull request exists.",
  },
  {
    id: "fetching",
    label: "Fetching pull request diff",
    message: "Reading the files the pull request changes, and checking it has not moved on since.",
  },
  {
    id: "preparing",
    label: "Preparing repository graph",
    message:
      "Downloading the pull request's head commit and mapping its imports. Nothing in it is run.",
  },
  {
    id: "mapping",
    label: "Mapping changed files",
    message: "Matching each changed path to a file in that graph.",
  },
  {
    id: "calculating",
    label: "Calculating impact",
    message: "Following real imports outwards from the changed files.",
  },
  {
    id: "scoring",
    label: "Computing risk signals",
    message: "Applying the documented rules to what was found.",
  },
  {
    id: "checking",
    label: "Checking changed code",
    message:
      "Type-checking the changed files under the repository's own tsconfig. The compiler reads the code; nothing in it is run.",
  },
  {
    id: "saving",
    label: "Saving report",
    message: "Storing the report and the result of this run.",
  },
  {
    id: "complete",
    label: "Complete",
    message: "The stored report is ready to read.",
  },
] as const;

export type AnalysisStageId = (typeof ANALYSIS_STAGES)[number]["id"];

export function analysisStageOf(id: AnalysisStageId): (typeof ANALYSIS_STAGES)[number] {
  const stage = ANALYSIS_STAGES.find((candidate) => candidate.id === id);
  if (!stage) throw new Error(`${id} is not an analysis stage.`);
  return stage;
}

// One threshold for both kinds of run: an analysis downloads and parses a
// commit exactly as a repository run does, so it gets the same time limit and
// is called stale after the same silence.
export { PROCESSING_LIMIT_MS, STALE_AFTER_MS };

// Stale means only that no progress was recorded for this long. The process
// may have stopped, or may still be working without having reported.
export function isAnalysisStale(
  run: { status: string; progressedAt: string },
  now: number,
): boolean {
  return (
    (run.status === "running" || run.status === "pending") &&
    now - Date.parse(run.progressedAt) > STALE_AFTER_MS
  );
}

export const analysisTopic = (analysisId: string) => `analysis:${analysisId}`;
