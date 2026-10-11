import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RunProgress } from "@/components/run-progress";
import { getRun } from "@/lib/ingestion/runs";
import { getWorkspace } from "@/lib/workspace";

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

async function Run({ params }: { params: Promise<{ runId: string }> }) {
  await getWorkspace();
  const { runId } = await params;
  // A run in another organization is not found, the same as one that does not
  // exist: the database returns neither.
  const run = await getRun(runId);
  if (!run) notFound();

  return (
    <>
      <h1 className="font-mono text-xl font-semibold tracking-tight break-all">
        {run.repository ? `${run.repository.owner}/${run.repository.name}` : run.requestedUrl}
      </h1>
      <dl className="mt-2 mb-6 flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted">Run started</dt>
          <dd>
            <time dateTime={run.createdAt}>
              {dateTimeFormat.format(new Date(run.createdAt))} UTC
            </time>
          </dd>
        </div>
        {run.sourceSha && (
          <div className="flex gap-2">
            <dt className="text-muted">Commit</dt>
            <dd className="font-mono text-[0.8125rem] leading-5">{run.sourceSha}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="text-muted">Run</dt>
          <dd className="font-mono text-[0.8125rem] leading-5 break-all">{run.id}</dd>
        </div>
      </dl>
      <RunProgress
        initial={{
          id: run.id,
          status: run.status,
          stage: run.stage,
          lastCompletedStage: run.lastCompletedStage,
          failureReason: run.failureReason,
          progressedAt: run.progressedAt,
        }}
        repositoryId={run.repositoryId}
        hasGraph={run.repository?.hasGraph ?? false}
      />
    </>
  );
}

export default function RunPage({ params }: PageProps<"/app/runs/[runId]">) {
  return (
    <div className="max-w-5xl">
      <p className="mb-1 text-sm text-muted">Repository analysis</p>
      <Suspense>
        <Run params={params} />
      </Suspense>
    </div>
  );
}
