"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { analyzePullRequest, reanalyzePullRequest } from "@/lib/impact/actions";

// The forms that start a pull request analysis. Each shows, next to itself,
// why nothing was started when the server refuses.

function Refusal({ message }: { message: string }) {
  return (
    <p role="alert" className="enter mt-2 max-w-prose border-l-2 border-critical pl-3 text-sm text-critical">
      {message}
    </p>
  );
}

export function AnalyzeButton({
  repositoryId,
  pullRequestNumber,
}: {
  repositoryId: string;
  pullRequestNumber: number;
}) {
  const [state, action] = useActionState(analyzePullRequest, null);
  return (
    <form action={action}>
      <input type="hidden" name="repositoryId" value={repositoryId} />
      <input type="hidden" name="pullRequest" value={pullRequestNumber} />
      <SubmitButton quiet pendingLabel="Checking…">
        Analyze
      </SubmitButton>
      {state && <Refusal message={state.message} />}
    </form>
  );
}

export function AnalyzeNumberForm({ repositoryId }: { repositoryId: string }) {
  const [state, action] = useActionState(analyzePullRequest, null);
  return (
    <form action={action} className="panel px-5 py-4">
      <input type="hidden" name="repositoryId" value={repositoryId} />
      <label htmlFor="pull-request" className="block text-sm font-medium">
        Any pull request, by number
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id="pull-request"
          name="pullRequest"
          type="text"
          inputMode="numeric"
          required
          maxLength={300}
          autoComplete="off"
          spellCheck={false}
          placeholder="128"
          aria-describedby="pull-request-help"
          className="min-w-0 flex-1 basis-40 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[0.8125rem] transition-colors duration-150 placeholder:text-muted/70 hover:border-ink/30 focus-visible:border-accent"
        />
        <SubmitButton pendingLabel="Checking the pull request…">Analyze pull request</SubmitButton>
      </div>
      <p id="pull-request-help" className="mt-2 max-w-prose text-sm text-muted">
        Open, closed or merged. Its address on github.com works too.
      </p>
      {state && <Refusal message={state.message} />}
    </form>
  );
}

export function ReanalyzeForm({
  analysisId,
  children,
  quiet = false,
}: {
  analysisId: string;
  children: string;
  quiet?: boolean;
}) {
  const [state, action] = useActionState(reanalyzePullRequest, null);
  return (
    <form action={action}>
      <input type="hidden" name="analysisId" value={analysisId} />
      <SubmitButton quiet={quiet} pendingLabel="Starting a new analysis…">
        {children}
      </SubmitButton>
      {state && <Refusal message={state.message} />}
    </form>
  );
}
