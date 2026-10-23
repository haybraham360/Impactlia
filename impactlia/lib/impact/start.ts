import "server-only";
import { after } from "next/server";
import {
  MAX_PULL_REQUEST_NUMBER,
  findPullRequest,
  type PullRequest,
} from "@/lib/github/pull-request";
import { findPublicRepository } from "@/lib/github/public-repository";
import { runImpactPipeline } from "@/lib/impact/pipeline";
import {
  findCompletedAnalysis,
  findUnfinishedAnalysis,
  getRepositoryIdentity,
  insertAnalysis,
  upsertPullRequest,
} from "@/lib/impact/runs";
import { BUDGETS } from "@/lib/ingestion/budgets";
import { IngestionError } from "@/lib/ingestion/errors";
import { countActiveWork } from "@/lib/ingestion/runs";
import { BUSY } from "@/lib/ingestion/start";
import { createRunSupabaseClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export type StartAnalysisOutcome =
  // An analysis to open: newly started, already running, or already stored.
  | { kind: "analysis"; analysisId: string }
  // Nothing was started, and why, in words written for the person asking.
  | { kind: "refused"; message: string };

// "#128", "128" or the pull request's address on github.com. Anything else,
// and any number GitHub could not have issued, is refused before it is used.
export function parsePullRequestNumber(input: string): number | null {
  const text = input.trim();
  const match =
    /^#?(\d{1,10})$/.exec(text) ??
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d{1,10})(?:[/?#].*)?$/i.exec(text);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= MAX_PULL_REQUEST_NUMBER ? number : null;
}

// The one way a pull request analysis starts.
//
// Access is checked here, on the server, every time: the repository has to be
// one of this organization's rows, GitHub has to still serve it publicly under
// the same id, and GitHub has to have the pull request.
//
// "submit" is someone choosing a pull request: one already analysed at its
// current head commit is opened, not analysed again. "reanalyze" is the
// deliberate request for a fresh run, which becomes a new row beside the old
// one. Either way a pull request with an analysis in progress at that commit
// gets that analysis back rather than a second one.
export async function startPullRequestAnalysis(
  repositoryId: string,
  pullRequestNumber: number,
  mode: "submit" | "reanalyze",
): Promise<StartAnalysisOutcome> {
  const workspace = await getWorkspace();
  const client = await createRunSupabaseClient();

  // Read through the member's own token, so a repository in another
  // organization is simply not there.
  const repository = await getRepositoryIdentity(client, repositoryId);
  if (!repository || repository.isSeed) {
    return { kind: "refused", message: "That repository is not in this organization." };
  }

  let pullRequest: PullRequest;
  try {
    const current = await findPublicRepository(repository);
    if (current.providerRepositoryId !== repository.providerRepositoryId) {
      throw new IngestionError(
        `${repository.owner}/${repository.name} on GitHub is now a different repository from the one added here. Add it again from its address.`,
      );
    }
    pullRequest = await findPullRequest(current, pullRequestNumber);
  } catch (error) {
    if (error instanceof IngestionError) return { kind: "refused", message: error.message };
    console.error("Pull request validation failed unexpectedly:", error);
    return {
      kind: "refused",
      message:
        "Something went wrong while checking the pull request with GitHub. The details were logged on the server.",
    };
  }

  const pullRequestId = await upsertPullRequest(
    client,
    workspace.organizationId,
    repository.id,
    pullRequest,
  );

  const unfinished = await findUnfinishedAnalysis(client, pullRequestId, pullRequest.headSha);
  if (unfinished) return { kind: "analysis", analysisId: unfinished };

  if (mode === "submit") {
    const stored = await findCompletedAnalysis(client, pullRequestId, pullRequest.headSha);
    if (stored) return { kind: "analysis", analysisId: stored };
  }

  if ((await countActiveWork(client, workspace.organizationId)) >= BUDGETS.activeRunsPerOrganization) {
    return { kind: "refused", message: BUSY };
  }

  const analysisId = await insertAnalysis(
    client,
    workspace.organizationId,
    pullRequestId,
    pullRequest,
  );
  if (analysisId === null) {
    // Another submission started one between the check and the insert.
    const winner = await findUnfinishedAnalysis(client, pullRequestId, pullRequest.headSha);
    if (winner) return { kind: "analysis", analysisId: winner };
    return {
      kind: "refused",
      message: "An analysis of this pull request started and finished at the same moment. Try again.",
    };
  }

  // The response goes back now; the analysis carries on in this server process.
  after(() => runImpactPipeline(client, analysisId, repository.id, repository, pullRequest));
  return { kind: "analysis", analysisId };
}
