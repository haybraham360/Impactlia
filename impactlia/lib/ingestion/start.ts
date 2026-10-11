import "server-only";
import { after } from "next/server";
import { findPublicRepository, type PublicRepository } from "@/lib/github/public-repository";
import { MAX_URL_LENGTH, parseRepositoryUrl } from "@/lib/github/repository-url";
import { IngestionError } from "@/lib/ingestion/errors";
import { runPipeline } from "@/lib/ingestion/pipeline";
import {
  ensureOrganization,
  findRunningRun,
  hasStoredGraph,
  insertFailedSubmission,
  insertRun,
  upsertRepository,
} from "@/lib/ingestion/runs";
import { createRunSupabaseClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export type StartOutcome =
  // A run to watch: newly started, already running, or failed at validation.
  | { kind: "run"; runId: string }
  // The repository already has a stored analysis and nothing was started.
  | { kind: "existing"; repositoryId: string };

// The one way a repository run starts.
//
// "submit" is someone entering an address: a repository that has already been
// analysed is opened, not analysed again. "reanalyze" is the deliberate
// request for a fresh run. Either way a repository with a run in progress gets
// that run back rather than a second one.
export async function startAnalysis(
  requestedUrl: string,
  mode: "submit" | "reanalyze",
): Promise<StartOutcome> {
  const workspace = await getWorkspace();
  const client = await createRunSupabaseClient();
  await ensureOrganization(client, workspace.organizationId);

  const recordedUrl = requestedUrl.trim().slice(0, MAX_URL_LENGTH) || "(nothing entered)";

  let repository: PublicRepository;
  try {
    repository = await findPublicRepository(parseRepositoryUrl(requestedUrl));
  } catch (error) {
    if (!(error instanceof IngestionError)) {
      console.error("Repository validation failed unexpectedly:", error);
    }
    const reason =
      error instanceof IngestionError
        ? error.message
        : "Something went wrong while checking the repository. The details were logged on the server.";
    const runId = await insertFailedSubmission(
      client,
      workspace.organizationId,
      recordedUrl,
      reason,
    );
    return { kind: "run", runId };
  }

  const repositoryId = await upsertRepository(client, workspace.organizationId, repository);
  if (mode === "submit" && (await hasStoredGraph(client, repositoryId))) {
    return { kind: "existing", repositoryId };
  }

  const running = await findRunningRun(client, repositoryId);
  if (running) return { kind: "run", runId: running };

  const runId = await insertRun(client, workspace.organizationId, repositoryId, recordedUrl);
  if (runId === null) {
    // Another submission started one between the check and the insert.
    const winner = await findRunningRun(client, repositoryId);
    if (winner) return { kind: "run", runId: winner };
    throw new Error("A run of this repository started and finished at the same moment. Try again.");
  }

  // The response goes back now; the run carries on in this server process.
  after(() => runPipeline(client, runId, repository));
  return { kind: "run", runId };
}
