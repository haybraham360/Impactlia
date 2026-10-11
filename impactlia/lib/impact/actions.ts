"use server";

import { redirect } from "next/navigation";
import { closeStaleAnalysis, getAnalysis } from "@/lib/impact/runs";
import { parsePullRequestNumber, startPullRequestAnalysis } from "@/lib/impact/start";
import { WORKSPACE_PATH, analysisPath } from "@/lib/routes";
import { createRunSupabaseClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

// What the form shows when nothing was started.
export type AnalyzeState = { message: string } | null;

// Starts an analysis, or opens the one that already covers the pull request's
// current head commit. A refusal comes back to the form that asked.
export async function analyzePullRequest(
  _previous: AnalyzeState,
  form: FormData,
): Promise<AnalyzeState> {
  await getWorkspace();
  const number = parsePullRequestNumber(field(form, "pullRequest"));
  if (number === null) {
    return {
      message: "Enter a pull request number, like 128, or the pull request's address on github.com.",
    };
  }
  const outcome = await startPullRequestAnalysis(field(form, "repositoryId"), number, "submit");
  if (outcome.kind === "refused") return { message: outcome.message };
  redirect(analysisPath(outcome.analysisId));
}

// Retrying and re-analysing never reopen an analysis. A finished one stays as
// it is; a stale one is closed first, and only if it is still stale at that
// moment. What starts is a new analysis of the same pull request, at whatever
// its head commit is now.
export async function reanalyzePullRequest(
  _previous: AnalyzeState,
  form: FormData,
): Promise<AnalyzeState> {
  await getWorkspace();
  const analysis = await getAnalysis(field(form, "analysisId"));
  if (!analysis) redirect(WORKSPACE_PATH);

  if (analysis.status === "running" || analysis.status === "pending") {
    if (!analysis.stale) redirect(analysisPath(analysis.id));
    await closeStaleAnalysis(await createRunSupabaseClient(), analysis.id);
  }
  const outcome = await startPullRequestAnalysis(
    analysis.repository.id,
    analysis.pullRequest.number,
    "reanalyze",
  );
  if (outcome.kind === "refused") return { message: outcome.message };
  redirect(analysisPath(outcome.analysisId));
}
