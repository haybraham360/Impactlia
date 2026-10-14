import Link from "next/link";
import { Suspense, cache, type ReactNode } from "react";
import { AnalysisRunList, runStateOf } from "@/components/analysis-run-list";
import {
  ArrowRightIcon,
  CheckIcon,
  OverviewIcon,
  PullRequestIcon,
  RepositoryIcon,
  TeamIcon,
} from "@/components/icons";
import { RepositoryForm } from "@/components/repository-form";
import { RepositoryList } from "@/components/repository-list";
import { RUN_LIMIT, listAnalysisRuns } from "@/lib/impact/runs";
import { REPOSITORY_LIMIT, listFailedSubmissions, listRepositories } from "@/lib/ingestion/runs";
import { PULL_REQUESTS_PATH, TEAM_PATH, analysisPath } from "@/lib/routes";
import { getWorkspace } from "@/lib/workspace";

const roleLabels: Record<string, string> = {
  "org:admin": "Admin",
  "org:member": "Member",
};

// One read of each list per request, shared by every section of the page
// that needs it. Each query is limited and names its columns; the database
// policies decide which organization's rows come back.
const loadOverview = cache(async () => {
  // Resolved first so a session without an organization is redirected before
  // anything is read.
  const workspace = await getWorkspace();
  const [repositories, failedSubmissions, runs] = await Promise.all([
    listRepositories(),
    listFailedSubmissions(),
    listAnalysisRuns(),
  ]);
  return { workspace, repositories, failedSubmissions, runs };
});

type Overview = Awaited<ReturnType<typeof loadOverview>>;

// What the organization has actually done, read from its rows. Nothing here
// is marked done unless a stored record says so.
function progressOf({ repositories, runs }: Overview) {
  const mapped = repositories.some((repository) => repository.hasGraph);
  const firstReport = runs.find((run) => run.status === "completed") ?? null;
  return [
    {
      title: "Add a repository",
      detail: "A public GitHub repository, mapped once and shared with your organization.",
      done: mapped,
      href: "#add-repository",
      action: "Add one below",
    },
    {
      title: "Analyze a pull request",
      detail: "Pick one of its pull requests to trace what the change could reach.",
      done: runs.length > 0,
      href: PULL_REQUESTS_PATH,
      action: "Choose a pull request",
    },
    {
      title: "Read your first impact report",
      detail: "Changed files, what imports them, the risk signals and suggested checks.",
      done: firstReport !== null,
      href: firstReport ? analysisPath(firstReport.id) : null,
      action: "Open it",
    },
  ];
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

function WelcomeFallback() {
  return (
    <div className="panel min-h-56 p-6 sm:p-8">
      <span className="sr-only">Loading the workspace…</span>
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-5 h-8 w-full max-w-md" />
      <Skeleton className="mt-4 h-4 w-full max-w-lg" />
      <Skeleton className="mt-8 h-10 w-48" />
    </div>
  );
}

async function Welcome() {
  const overview = await loadOverview();
  const { workspace } = overview;
  const steps = progressOf(overview);
  const done = steps.filter((step) => step.done).length;
  const mapped = steps[0].done;

  return (
    <section aria-labelledby="welcome-heading" className="panel relative overflow-hidden">
      {/* Still light, behind the text; it does not move. */}
      <div
        aria-hidden="true"
        className="panel-glow pointer-events-none absolute inset-0"
      />
      <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="font-medium text-ink">{workspace.organizationName}</span>
            <span>
              {roleLabels[workspace.organizationRole] ?? workspace.organizationRole}
            </span>
            <span className="font-mono break-all" title="Organization ID">
              {workspace.organizationId}
            </span>
          </p>
          <h1
            id="welcome-heading"
            className="mt-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          >
            Understand the impact before you merge.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted">
            Choose a repository and one of its pull requests to see which files it changes,
            which files import them, and what is worth reviewing or testing.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {mapped ? (
              <Link href={PULL_REQUESTS_PATH} className="btn btn-primary">
                <PullRequestIcon />
                Analyze a pull request
              </Link>
            ) : (
              <a href="#add-repository" className="btn btn-primary">
                <RepositoryIcon />
                Add a repository
              </a>
            )}
          </div>
        </div>

        {done < steps.length && (
          <div className="rounded-xl border border-line bg-canvas/50 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Getting started</h2>
              <p className="text-xs text-muted tabular-nums">
                {done} of {steps.length} done
              </p>
            </div>
            {/* One segment per step, filled only for steps the records show
                as done. */}
            <div aria-hidden="true" className="mt-3 flex gap-1">
              {steps.map((step) => (
                <span
                  key={step.title}
                  className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                    step.done ? "bg-accent" : "bg-line"
                  }`}
                />
              ))}
            </div>
            <ol className="mt-4 space-y-3.5">
              {steps.map((step, index) => {
                const next = !step.done && steps.slice(0, index).every((earlier) => earlier.done);
                return (
                  <li key={step.title} className="flex gap-3 text-sm">
                    <span
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold tabular-nums ${
                        step.done
                          ? "bg-accent text-accent-ink"
                          : next
                            ? "border border-accent text-accent"
                            : "border border-line text-muted"
                      }`}
                    >
                      {step.done ? <CheckIcon className="size-3" /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block font-medium ${step.done ? "text-muted line-through decoration-muted/60" : ""}`}>
                        {step.title}
                        <span className="sr-only">{step.done ? ": done" : ": not done yet"}</span>
                      </span>
                      {next && (
                        <>
                          <span className="block text-muted">{step.detail}</span>
                          {step.href && (
                            <a
                              href={step.href}
                              className="mt-1 inline-flex items-center gap-1 text-accent hover:underline"
                            >
                              {step.action}
                              <ArrowRightIcon className="size-3.5" />
                            </a>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  icon,
  tone = "text-accent",
}: {
  label: string;
  value: number;
  note?: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <div className="panel lift p-4">
      <dt className="flex items-center gap-2 text-xs text-muted">
        <span className={tone}>{icon}</span>
        {label}
      </dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-muted">{note}</dd>}
    </div>
  );
}

// Counted from the same rows the lists below show, so the numbers and the
// lists cannot disagree. Where a list is capped, the number says so.
async function Metrics() {
  const { repositories, runs } = await loadOverview();
  if (repositories.length === 0 && runs.length === 0) return null;

  const states = runs.map(runStateOf);
  const runsNote = runs.length === RUN_LIMIT ? `Of the latest ${RUN_LIMIT} analyses` : undefined;
  const repositoriesNote =
    repositories.length === REPOSITORY_LIMIT ? `Of the latest ${REPOSITORY_LIMIT}` : undefined;

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric
        label="Repositories mapped"
        value={repositories.filter((repository) => repository.hasGraph).length}
        note={repositoriesNote}
        icon={<RepositoryIcon className="size-3.5" />}
      />
      <Metric
        label="Analyses completed"
        value={states.filter((state) => state === "completed").length}
        note={runsNote}
        icon={<CheckIcon className="size-3.5" />}
        tone="text-positive"
      />
      <Metric
        label="In progress"
        value={states.filter((state) => state === "running" || state === "pending").length}
        note={runsNote}
        icon={<OverviewIcon className="size-3.5" />}
      />
      <Metric
        label="Failed or stale"
        value={states.filter((state) => state === "failed" || state === "stale").length}
        note={runsNote ?? "Analyses that need a retry"}
        icon={<span aria-hidden="true" className="block size-2 rotate-45 bg-current" />}
        tone="text-critical"
      />
    </dl>
  );
}

function ListFallback({ rows }: { rows: number }) {
  return (
    <div className="panel divide-y divide-line">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-5 px-5 py-4">
          <Skeleton className="h-6 w-24 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-full max-w-sm" />
            <Skeleton className="mt-2 h-3 w-full max-w-xs" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function Repositories() {
  const { repositories, failedSubmissions } = await loadOverview();
  return <RepositoryList repositories={repositories} failedSubmissions={failedSubmissions} />;
}

async function AnalysisRuns() {
  const { runs } = await loadOverview();
  return <AnalysisRunList runs={runs} />;
}

function SectionHeader({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted">{children}</p>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <div className="enter mx-auto max-w-6xl">
      {/* One boundary for both: they read the same data, and arriving
          together keeps the page from shifting twice. */}
      <Suspense fallback={<WelcomeFallback />}>
        <Welcome />
        <div className="mt-4">
          <Metrics />
        </div>
      </Suspense>

      <section aria-labelledby="repositories" className="mt-12 scroll-mt-20">
        <SectionHeader id="repositories" title="Repositories">
          Each repository is analyzed once and its dependency map is stored for everyone in this
          organization.
        </SectionHeader>
        <div id="add-repository" className="scroll-mt-20">
          <RepositoryForm />
        </div>
        <div className="mt-4">
          <Suspense fallback={<ListFallback rows={2} />}>
            <Repositories />
          </Suspense>
        </div>
      </section>

      <section aria-labelledby="analysis-runs" className="mt-12 scroll-mt-20">
        <SectionHeader id="analysis-runs" title="Analysis runs">
          The most recent analyses of this organization’s pull requests. A completed analysis
          means the report is ready, not that the change is safe.
        </SectionHeader>
        <Suspense fallback={<ListFallback rows={3} />}>
          <AnalysisRuns />
        </Suspense>
      </section>

      <section className="panel mt-12 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-line text-accent">
            <TeamIcon />
          </span>
          <div>
            <h2 className="font-semibold">Team</h2>
            <p className="text-sm text-muted">Everyone in this organization shares this workspace.</p>
          </div>
        </div>
        <Link href={TEAM_PATH} className="btn btn-secondary btn-small">
          Invite people
        </Link>
      </section>
    </div>
  );
}
