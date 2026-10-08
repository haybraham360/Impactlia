import Link from "next/link";
import { Suspense } from "react";
import { getWorkspace } from "@/lib/workspace";

const roleLabels: Record<string, string> = {
  "org:admin": "Admin",
  "org:member": "Member",
};

// The path a change takes through Impactlia. It is a real sequence, which is
// why it is numbered.
const steps = [
  {
    title: "Connect a repository",
    detail: "Impactlia reads its structure and dependencies.",
  },
  {
    title: "Select a pull request",
    detail: "The changed files are matched against that structure.",
  },
  {
    title: "Read the impact analysis",
    detail: "What the change could affect, and what to review or test.",
  },
];

async function OrganizationContext() {
  const workspace = await getWorkspace();

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        {workspace.organizationName}
      </h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted">Your role</dt>
        <dd>
          {roleLabels[workspace.organizationRole] ??
            workspace.organizationRole}
        </dd>
        <dt className="text-muted">Organization ID</dt>
        <dd className="font-mono text-[0.8125rem] break-all">
          {workspace.organizationId}
        </dd>
      </dl>
    </>
  );
}

export default function OverviewPage() {
  return (
    <div className="max-w-2xl">
      <div className="min-h-28">
        <Suspense>
          <OrganizationContext />
        </Suspense>
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">From change to impact</h2>
        <p className="mt-1 text-sm text-muted">
          None of these steps is available yet. They will open here, in this
          order.
        </p>
        <ol className="mt-5 border-l border-line">
          {steps.map((step, index) => (
            <li key={step.title} className="relative pb-6 pl-8 last:pb-0">
              <span className="absolute top-0 -left-3 grid size-6 place-items-center rounded-full border border-line bg-canvas font-mono text-xs text-muted">
                {index + 1}
              </span>
              <p className="font-medium">{step.title}</p>
              <p className="text-sm text-muted">{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Team</h2>
        <p className="mt-1 text-sm text-muted">
          Everyone in this organization shares this workspace.
        </p>
        <Link
          href="/team"
          className="mt-4 inline-block rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
        >
          Invite people
        </Link>
      </section>
    </div>
  );
}
