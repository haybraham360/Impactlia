import Link from "next/link";
import { Suspense } from "react";
import { AnalysisRunList } from "@/components/analysis-run-list";
import { listAnalysisRuns } from "@/lib/analysis-runs";
import { TEAM_PATH } from "@/lib/routes";
import { getWorkspace } from "@/lib/workspace";

const roleLabels: Record<string, string> = {
  "org:admin": "Admin",
  "org:member": "Member",
};

async function OrganizationContext() {
  const workspace = await getWorkspace();

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        {workspace.organizationName}
      </h1>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted">Your role</dt>
          <dd>
            {roleLabels[workspace.organizationRole] ??
              workspace.organizationRole}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Organization ID</dt>
          <dd className="font-mono text-[0.8125rem] leading-5 break-all">
            {workspace.organizationId}
          </dd>
        </div>
      </dl>
    </>
  );
}

async function AnalysisRuns() {
  // Resolved first so a session without an organization is redirected before
  // anything is read.
  await getWorkspace();
  return <AnalysisRunList runs={await listAnalysisRuns()} />;
}

export default function OverviewPage() {
  return (
    <div className="max-w-5xl">
      <div className="min-h-24 border-b border-line pb-6">
        <Suspense>
          <OrganizationContext />
        </Suspense>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Analysis runs</h2>
        <p className="mt-1 mb-5 text-sm text-muted">
          The most recent analyses of this organization’s pull requests.
        </p>
        <Suspense>
          <AnalysisRuns />
        </Suspense>
      </section>

      <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line px-5 py-4">
        <div>
          <h2 className="font-semibold">Team</h2>
          <p className="text-sm text-muted">
            Everyone in this organization shares this workspace.
          </p>
        </div>
        <Link
          href={TEAM_PATH}
          className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
        >
          Invite people
        </Link>
      </section>
    </div>
  );
}
