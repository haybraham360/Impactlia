import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnalysisWorkspace } from "@/components/analysis-workspace";
import { SubmitButton } from "@/components/submit-button";
import { summariseCoverage } from "@/lib/graph/coverage";
import { buildGraphModel } from "@/lib/graph/model";
import { reanalyzeRepository, retryRun } from "@/lib/ingestion/actions";
import { getStoredAnalysis, type RepositoryRun, type StoredAnalysis } from "@/lib/ingestion/runs";
import { stageOf } from "@/lib/ingestion/stages";
import { summariseRepository } from "@/lib/repository-overview";
import { WORKSPACE_PATH, runPath } from "@/lib/routes";
import { getWorkspace } from "@/lib/workspace";
import type { ParserOutput } from "@/parser/contract";
import { readParserOutput } from "@/parser/validate";

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16 text-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-muted">{children}</div>
    </div>
  );
}

function Reanalyze({ repositoryId }: { repositoryId: string }) {
  return (
    <form action={reanalyzeRepository}>
      <input type="hidden" name="repositoryId" value={repositoryId} />
      <SubmitButton quiet pendingLabel="Starting…">
        Re-analyze
      </SubmitButton>
    </form>
  );
}

function Retry({ runId }: { runId: string }) {
  return (
    <form action={retryRun}>
      <input type="hidden" name="runId" value={runId} />
      <SubmitButton pendingLabel="Starting a new run…">Retry</SubmitButton>
    </form>
  );
}

// What the latest run is doing, when it is not the run the map came from.
function LatestRunNote({ run }: { run: RepositoryRun }) {
  if (run.status === "completed") return null;
  const { stale } = run;
  return (
    <p className="flex flex-wrap items-center gap-x-2 border-b border-line bg-surface px-4 py-2 text-sm">
      <span className={run.status === "failed" ? "text-critical" : stale ? "text-caution" : ""}>
        {run.status === "failed"
          ? `The latest run failed in “${stageOf(run.stage).label}”.`
          : stale
            ? "A newer run has recorded no progress for a while and is marked stale."
            : `A new run is in progress: ${stageOf(run.stage).label}.`}
      </span>
      <span className="text-muted">This map is from the last run that completed.</span>
      <Link href={runPath(run.id)} className="text-accent hover:underline">
        {run.status === "running" && !stale ? "Watch progress" : "Run details"}
      </Link>
    </p>
  );
}

function Header({ analysis }: { analysis: StoredAnalysis | null }) {
  const graph = analysis?.graph;
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface px-4 py-2.5 text-sm">
      <Link href={WORKSPACE_PATH} className="text-base font-semibold tracking-tight">
        Impactlia
      </Link>
      {analysis && (
        <>
          <h1 className="font-mono text-[0.9375rem] font-medium break-all">
            {analysis.repository.owner}/{analysis.repository.name}
          </h1>
          {graph && (
            <p className="text-muted">
              {graph.sourceSha ? (
                <>
                  Commit{" "}
                  <a
                    href={`https://github.com/${analysis.repository.owner}/${analysis.repository.name}/commit/${graph.sourceSha}`}
                    title={graph.sourceSha}
                    className="font-mono text-[0.8125rem] text-ink hover:underline"
                  >
                    {graph.sourceSha.slice(0, 7)}
                  </a>{" "}
                  on {analysis.repository.defaultBranch}
                </>
              ) : (
                "Commit not verified: the archive did not state it"
              )}
              {graph.completedAt && (
                <>
                  , analyzed{" "}
                  <time dateTime={graph.completedAt}>
                    {dateTimeFormat.format(new Date(graph.completedAt))} UTC
                  </time>
                </>
              )}
            </p>
          )}
          <div className="ml-auto">
            {analysis.latestRun?.status !== "running" && (
              <Reanalyze repositoryId={analysis.repository.id} />
            )}
          </div>
        </>
      )}
    </header>
  );
}

async function Explorer({ params }: { params: Promise<{ repositoryId: string }> }) {
  await getWorkspace();
  const { repositoryId } = await params;
  // A repository in another organization is not found, the same as one that
  // does not exist: the database returns neither.
  const analysis = await getStoredAnalysis(repositoryId);
  if (!analysis) notFound();
  const { graph, latestRun } = analysis;

  if (!graph) {
    const stale = latestRun?.stale ?? false;
    return (
      <>
        <Header analysis={analysis} />
        <Notice title="No analysis is stored for this repository yet">
          {!latestRun && <p>No run has been started.</p>}
          {latestRun?.status === "running" && (
            <p>
              {stale
                ? "Its run has recorded no progress for a while and is marked stale. "
                : `Its first run is in progress: ${stageOf(latestRun.stage).label}. `}
              <Link href={runPath(latestRun.id)} className="text-accent hover:underline">
                {stale ? "Run details" : "Watch progress"}
              </Link>
            </p>
          )}
          {latestRun?.status === "failed" && (
            <>
              <p>
                The latest run failed in “{stageOf(latestRun.stage).label}”, so there is no
                map to show.
              </p>
              <p className="border-l-2 border-critical pl-3 text-critical">
                {latestRun.failureReason}
              </p>
              <Retry runId={latestRun.id} />
            </>
          )}
        </Notice>
      </>
    );
  }

  // The stored document is checked against the parser contract every time it
  // is read. One that does not pass is shown as unusable, never as a graph.
  let output: ParserOutput;
  try {
    output = readParserOutput(graph.parserOutput);
  } catch (error) {
    return (
      <>
        <Header analysis={analysis} />
        <Notice title="The stored analysis could not be used">
          <p>
            What is stored for this repository did not pass validation, so nothing from it
            is shown. Re-analyzing replaces it.
          </p>
          <p className="border-l-2 border-critical pl-3 text-critical">
            {error instanceof Error ? error.message : String(error)}
          </p>
        </Notice>
      </>
    );
  }

  return (
    <>
      <Header analysis={analysis} />
      {latestRun && <LatestRunNote run={latestRun} />}
      <AnalysisWorkspace
        overview={summariseRepository(output)}
        model={buildGraphModel(output)}
        coverage={summariseCoverage(output)}
      />
    </>
  );
}

export default function RepositoryPage({
  params,
}: PageProps<"/app/repositories/[repositoryId]">) {
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <Suspense fallback={<Header analysis={null} />}>
        <Explorer params={params} />
      </Suspense>
    </div>
  );
}
