import Link from "next/link";
import { AutomationToggle } from "@/components/automation-forms";
import { SubmitButton } from "@/components/submit-button";
import { connectGitHub } from "@/lib/automation/actions";
import {
  CONNECT_OUTCOMES,
  getRepositoryAutomation,
  listAutomaticRuns,
  listInstallations,
  type AutomaticAnalysisStatus,
  type AutomaticRun,
  type ConnectOutcome,
} from "@/lib/automation/status";
import { automation } from "@/lib/env";
import { repositoryUrl } from "@/lib/github/repository-url";
import type { RepositoryIdentity } from "@/lib/impact/runs";
import { analysisPath } from "@/lib/routes";

// Automatic analysis for the selected repository: whether GitHub is
// connected, whether it is on, what the App may do, and what it did lately.
// Every fact here is a stored row; nothing is asked of GitHub to draw it.

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const states: Record<AutomaticAnalysisStatus, { label: string; tone: string; pill: string }> = {
  queued: { label: "Queued", tone: "text-muted", pill: "border-line" },
  running: { label: "Running", tone: "text-accent", pill: "border-accent/30 bg-accent/10" },
  completed: { label: "Completed", tone: "text-positive", pill: "border-positive/30 bg-positive/10" },
  failed: { label: "Failed", tone: "text-critical", pill: "border-critical/30 bg-critical/10" },
  stale: { label: "Stale", tone: "text-caution", pill: "border-caution/40 bg-caution/10" },
  skipped: { label: "Skipped", tone: "text-muted", pill: "border-line" },
};

function Pill({ label, tone, pill }: { label: string; tone: string; pill: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone} ${pill}`}>
      {label}
    </span>
  );
}

function ConnectButton({ repositoryId, quiet, children }: { repositoryId: string; quiet: boolean; children: string }) {
  return (
    <form action={connectGitHub}>
      <input type="hidden" name="repositoryId" value={repositoryId} />
      <SubmitButton quiet={quiet} pendingLabel="Opening GitHub…">
        {children}
      </SubmitButton>
    </form>
  );
}

function RunRow({ run, repository }: { run: AutomaticRun; repository: RepositoryIdentity }) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 border-t border-line py-3 text-sm first:border-t-0">
      <span className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-x-2 gap-y-1">
        <a
          href={`${repositoryUrl(repository)}/pull/${run.pullRequestNumber}`}
          className="font-mono text-[0.8125rem] font-medium hover:underline"
        >
          #{run.pullRequestNumber}
        </a>
        <span className="font-mono text-[0.8125rem] text-muted">{run.headSha.slice(0, 7)}</span>
        <Pill {...states[run.status]} />
        {run.commentPublished && <span className="text-xs text-muted">Comment posted</span>}
        <time dateTime={run.updatedAt} className="text-xs text-muted">
          {dateTimeFormat.format(new Date(run.updatedAt))} UTC
        </time>
      </span>
      {run.analysisId && (
        <Link href={analysisPath(run.analysisId)} className="shrink-0 text-accent hover:underline">
          View analysis
        </Link>
      )}
      {run.message && <p className="basis-full text-muted">{run.message}</p>}
    </li>
  );
}

export async function AutomaticAnalysis({
  repository,
  outcome,
}: {
  repository: RepositoryIdentity;
  outcome: ConnectOutcome | null;
}) {
  const heading = (
    <h2 id="automatic-analysis" className="text-lg font-semibold">
      Automatic analysis
    </h2>
  );
  const notice = outcome && (
    <p
      role="status"
      className={`mt-3 max-w-prose border-l-2 pl-3 text-sm ${
        outcome === "connected" ? "border-positive" : "border-critical text-critical"
      }`}
    >
      {CONNECT_OUTCOMES[outcome]}
    </p>
  );

  if (!automation.config) {
    return (
      <section aria-labelledby="automatic-analysis" className="panel mb-8 px-5 py-4">
        {heading}
        {notice}
        <p className="mt-1 max-w-prose text-sm text-muted">
          Not set up on this server yet, so pull requests are analysed only when someone starts
          one here. Missing: <span className="font-mono text-[0.8125rem]">{automation.missing.join(", ")}</span>.
        </p>
      </section>
    );
  }

  const [installations, setting, runs] = await Promise.all([
    listInstallations(),
    getRepositoryAutomation(repository.id),
    listAutomaticRuns(repository.id),
  ]);
  const active = installations.filter((installation) => !installation.removed);
  const linked = installations.find(
    (installation) => installation.installationId === setting?.installationId,
  );
  const enabled = setting?.enabled ?? false;

  // One sentence for where things stand, most blocking first.
  let status: { pill: { label: string; tone: string; pill: string }; text: string };
  if (enabled && linked?.removed) {
    status = {
      pill: states.failed,
      text: `The Impactlia GitHub App was removed from ${linked.accountLogin}. Connect GitHub again to resume.`,
    };
  } else if (enabled && linked?.suspended) {
    status = {
      pill: states.stale,
      text: `The Impactlia GitHub App is suspended on ${linked.accountLogin}. Nothing is analysed until it is resumed on GitHub.`,
    };
  } else if (enabled) {
    status = {
      pill: { label: "On", tone: "text-positive", pill: "border-positive/30 bg-positive/10" },
      text: `Pull requests are analysed when they are opened, reopened or pushed to, through the installation on ${linked?.accountLogin ?? "GitHub"}.`,
    };
  } else if (active.length === 0) {
    status = {
      pill: { label: "GitHub not connected", tone: "text-muted", pill: "border-line" },
      text: "Connect GitHub to install the Impactlia GitHub App, choosing this repository when GitHub asks which ones.",
    };
  } else {
    status = {
      pill: { label: "Off", tone: "text-muted", pill: "border-line" },
      text: "Pull requests of this repository are analysed only when someone starts one here.",
    };
  }

  return (
    <section aria-labelledby="automatic-analysis" className="panel mb-8 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            {heading}
            <Pill {...status.pill} />
          </div>
          <p className="mt-1 max-w-prose text-sm text-muted">{status.text}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {active.length > 0 && !(enabled && linked?.removed) && (
            <AutomationToggle repositoryId={repository.id} enabled={enabled} />
          )}
          <ConnectButton repositoryId={repository.id} quiet={active.length > 0}>
            {active.length > 0 ? "Manage on GitHub" : "Connect GitHub"}
          </ConnectButton>
        </div>
      </div>
      {notice}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted hover:text-ink">What this does and what it may access</summary>
        <div className="mt-2 max-w-prose space-y-2 text-muted">
          <p>
            When a pull request is opened, reopened or pushed to, GitHub tells Impactlia. The pull
            request’s head commit is analysed exactly as it is when you start an analysis here,
            and Impactlia keeps one comment on the pull request up to date with the result and a
            link back to it. A result for a commit that is no longer the head is never posted.
          </p>
          <p>
            The Impactlia GitHub App reads repository metadata, code and pull requests, and writes
            pull request comments. It cannot push code, merge, approve, or change settings. Only
            public repositories are analysed, and nothing in the repository is run.
          </p>
        </div>
      </details>

      {runs.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium">Recent automatic analyses</h3>
          <ul className="mt-1">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} repository={repository} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
