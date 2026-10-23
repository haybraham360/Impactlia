"use server";

import { redirect } from "next/navigation";
import { repositoryUrl } from "@/lib/github/repository-url";
import { closeStaleRun, getRun, getStoredAnalysis } from "@/lib/ingestion/runs";
import { startAnalysis, type StartOutcome } from "@/lib/ingestion/start";
import { WORKSPACE_PATH, repositoryPath, runPath } from "@/lib/routes";
import { createRunSupabaseClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

function open(outcome: StartOutcome): never {
  redirect(
    outcome.kind === "run" ? runPath(outcome.runId) : repositoryPath(outcome.repositoryId),
  );
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

export async function submitRepository(form: FormData): Promise<void> {
  await getWorkspace();
  open(await startAnalysis(field(form, "url"), "submit"));
}

export async function reanalyzeRepository(form: FormData): Promise<void> {
  await getWorkspace();
  const analysis = await getStoredAnalysis(field(form, "repositoryId"));
  if (!analysis) redirect(WORKSPACE_PATH);
  open(await startAnalysis(repositoryUrl(analysis.repository), "reanalyze"));
}

// The same, reading the whole default branch again instead of updating the
// stored analysis.
export async function rebuildRepository(form: FormData): Promise<void> {
  await getWorkspace();
  const analysis = await getStoredAnalysis(field(form, "repositoryId"));
  if (!analysis) redirect(WORKSPACE_PATH);
  open(await startAnalysis(repositoryUrl(analysis.repository), "rebuild"));
}

// Retrying never reopens a run. A failed run stays failed; a stale one is
// closed first, and only if it is still stale at that moment. What starts is
// a new run of the same address.
export async function retryRun(form: FormData): Promise<void> {
  await getWorkspace();
  const run = await getRun(field(form, "runId"));
  if (!run) redirect(WORKSPACE_PATH);
  if (run.status === "completed") redirect(runPath(run.id));

  if (run.status === "running") {
    if (!run.stale) redirect(runPath(run.id));
    await closeStaleRun(await createRunSupabaseClient(), run.id);
  }
  open(
    await startAnalysis(
      run.repository ? repositoryUrl(run.repository) : run.requestedUrl,
      "reanalyze",
    ),
  );
}
