"use client";

import { Suspense, use, useCallback, useState, type ReactNode } from "react";
import { ExplanationText } from "@/components/explanation-text";
import { SubmitButton } from "@/components/submit-button";
import { requestExplanation } from "@/lib/ai/actions";
import {
  subjectKey,
  type ExplanationEntry,
  type Revision,
  type RoleSuggestion,
  type StoredAi,
  type SubjectKind,
} from "@/lib/ai/types";
import { reanalyzeRepository } from "@/lib/ingestion/actions";

// What the explorer hands the pane so it can explain things. Absent in the
// development preview, which has no stored repository to explain from.
export type AiContext = {
  repositoryId: string;
  // What was already stored when the page loaded, compared with this analysis.
  stored: StoredAi;
  // Resolves once GitHub has been asked where the default branch is now.
  revision: Promise<Revision>;
};

type Request = { pending: boolean; error: string | null; notes: string[] };

export type Explanations = {
  entry: (kind: SubjectKind, id: string) => ExplanationEntry | undefined;
  request: (kind: SubjectKind, id: string) => Request | undefined;
  role: (fileId: string) => RoleSuggestion | undefined;
  explain: (kind: SubjectKind, id: string) => void;
};

// Explanations live above the selection, so one that has been fetched is
// still there when its file is selected again. They belong to the one
// repository and analysis this page was rendered for, and are gone with it.
export function useExplanations(ai: AiContext | undefined): Explanations {
  const [entries, setEntries] = useState(ai?.stored.explanations ?? {});
  const [roles, setRoles] = useState(ai?.stored.roles ?? {});
  const [requests, setRequests] = useState<Record<string, Request>>({});
  const repositoryId = ai?.repositoryId;

  const explain = useCallback(
    (kind: SubjectKind, id: string) => {
      if (repositoryId === undefined) return;
      const key = subjectKey(kind, id);
      const settle = (request: Request) =>
        setRequests((current) => ({ ...current, [key]: request }));
      settle({ pending: true, error: null, notes: [] });
      requestExplanation(repositoryId, kind, id).then(
        (outcome) => {
          const { explanation, role } = outcome;
          if (explanation.ok) {
            setEntries((current) => ({ ...current, [key]: explanation.entry }));
          }
          if (role) setRoles((current) => ({ ...current, [id]: role }));
          settle({
            pending: false,
            error: explanation.ok ? null : explanation.message,
            notes: outcome.notes,
          });
        },
        () =>
          settle({
            pending: false,
            error: "The request did not reach the server. Check your connection and try again.",
            notes: [],
          }),
      );
    },
    [repositoryId],
  );

  return {
    entry: (kind, id) => entries[subjectKey(kind, id)],
    request: (kind, id) => requests[subjectKey(kind, id)],
    role: (fileId) => roles[fileId],
    explain,
  };
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const originText: Record<ExplanationEntry["origin"], string> = {
  stored: "Written earlier and kept.",
  cache: "Answered from the cache. No model was called for this request.",
  model: "Just written. The model was called for this request.",
};

function ActionButton({
  primary = false,
  disabled,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`cursor-pointer rounded-md border px-2.5 py-1 font-medium disabled:cursor-default disabled:opacity-60 ${
        primary ? "border-accent bg-accent text-accent-ink" : "border-line hover:bg-canvas"
      }`}
    >
      {children}
    </button>
  );
}

function Caution({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-l-2 border-caution pl-3">
      <p className="font-medium text-caution">{title}</p>
      <div className="mt-1 space-y-2 text-muted">{children}</div>
    </div>
  );
}

// Whether the commit this analysis is of is still the newest one. This says
// only what GitHub was asked when the page loaded, and says so when it could
// not be asked.
function RevisionNote({ ai }: { ai: AiContext }) {
  const revision = use(ai.revision);
  if (revision.status === "current") {
    return (
      <p className="text-xs text-muted">
        When this page loaded, the analysed commit was still the newest on the default branch.
      </p>
    );
  }
  if (revision.status === "unknown") {
    return (
      <Caution title="Freshness unknown">
        <p>
          Whether the repository has changed since this analysis could not be checked.{" "}
          {revision.reason}
        </p>
      </Caution>
    );
  }
  return (
    <Caution title="The repository has moved on">
      <p>
        Its default branch is now at commit{" "}
        <span className="font-mono text-[0.8125rem]">{revision.headSha.slice(0, 7)}</span>, which
        is newer than this analysis. Explanations here describe the analysed commit and may not
        match the code as it is now.
      </p>
      <form action={reanalyzeRepository}>
        <input type="hidden" name="repositoryId" value={ai.repositoryId} />
        <SubmitButton quiet pendingLabel="Starting…">
          Re-analyze repository
        </SubmitButton>
      </form>
    </Caution>
  );
}

export function ExplanationPanel({
  ai,
  explanations,
  kind,
  id,
  knownFiles,
  onSelectFile,
}: {
  ai: AiContext | undefined;
  explanations: Explanations;
  kind: SubjectKind;
  id: string;
  knownFiles: ReadonlySet<string>;
  onSelectFile: (fileId: string) => void;
}) {
  if (!ai) {
    return (
      <div className="px-5 py-4">
        <h3 className="font-medium">Not available in the preview</h3>
        <p className="mt-1 text-muted">
          Explanations are written for repositories analysed from GitHub. This preview reads
          parser output from disk, so there is nothing to explain from.
        </p>
      </div>
    );
  }

  const entry = explanations.entry(kind, id);
  const request = explanations.request(kind, id);
  const pending = request?.pending ?? false;
  const stale = entry !== undefined && entry.stale.length > 0;
  const explain = () => explanations.explain(kind, id);

  return (
    <div className="space-y-4 px-5 py-4">
      {ai.stored.problem && <p className="text-xs text-caution">{ai.stored.problem}</p>}

      {!entry && (
        <div>
          <h3 className="font-medium">No explanation yet</h3>
          <p className="mt-1 text-muted">
            {kind === "file"
              ? "Explain sends this file's source and the dependencies listed on the Structure tab to a model, which describes what the file appears to be for."
              : "Explain sends this folder's files, their roles and its dependencies to a model, which describes what the folder appears to contain. File contents are not sent."}{" "}
            The model cannot add to or change the dependencies.
          </p>
        </div>
      )}

      {entry && stale && (
        <Caution title="This explanation is out of date">
          <ul className="list-disc space-y-1 pl-4">
            {entry.stale.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>It is shown as it was written and does not describe the current analysis.</p>
        </Caution>
      )}

      {entry && (
        <>
          <ExplanationText text={entry.body} knownFiles={knownFiles} onSelectFile={onSelectFile} />
          {entry.omitted.length > 0 && (
            <div className="text-xs text-muted">
              <p>Left out of what the model read:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {entry.omitted.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {request?.error && (
        <div role="alert" className="border-l-2 border-critical pl-3">
          <p className="font-medium text-critical">
            {entry ? "The new request failed" : "The explanation could not be written"}
          </p>
          <p className="mt-1 text-muted">{request.error}</p>
        </div>
      )}
      {request?.notes.map((note) => (
        <p key={note} className="text-xs text-caution">
          {note}
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ActionButton primary={!entry || stale} disabled={pending} onClick={explain}>
          {pending
            ? "Writing…"
            : !entry
              ? "Explain"
              : stale
                ? "Refresh explanation"
                : request?.error
                  ? "Try again"
                  : "Request again"}
        </ActionButton>
        <p role="status" className="min-w-0 flex-1 text-xs text-muted">
          {pending
            ? "Checking the cache, then asking the model if needed."
            : entry && !stale
              ? "Unchanged inputs are answered from the cache."
              : ""}
        </p>
      </div>

      {entry && (
        <div className="space-y-2 border-t border-line pt-3 text-xs text-muted">
          <p>
            {originText[entry.origin]} Written{" "}
            <time dateTime={entry.createdAt}>
              {dateTimeFormat.format(new Date(entry.createdAt))} UTC
            </time>{" "}
            by {entry.model}
            {entry.sourceSha && (
              <>
                {" "}
                from commit{" "}
                <span className="font-mono">{entry.sourceSha.slice(0, 7)}</span>
              </>
            )}
            .
          </p>
          <p>
            This is a model&apos;s interpretation, not verified fact. The dependencies it mentions
            were supplied from the Structure tab; it may still describe them wrongly, and it says
            nothing certain about what a change would do.
          </p>
        </div>
      )}

      <Suspense
        fallback={<p className="text-xs text-muted">Checking the repository&apos;s newest commit…</p>}
      >
        <RevisionNote ai={ai} />
      </Suspense>
    </div>
  );
}
