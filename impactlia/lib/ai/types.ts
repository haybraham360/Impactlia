import type { SuggestedRole } from "./roles";

// What crosses from the server to the detail pane. Plain data only.

export type SubjectKind = "file" | "folder";

// The key an explanation is held under in the browser.
export const subjectKey = (kind: SubjectKind, id: string) => `${kind}:${id}`;

export type ExplanationEntry = {
  body: string;
  // What was left out of the model's input for size, in words.
  omitted: string[];
  model: string;
  // The commit of the analysis it was written from. Null when unknown.
  sourceSha: string | null;
  createdAt: string;
  // "stored": already there when the page loaded. "cache": this request was
  // answered from the cache. "model": this request called the model.
  origin: "stored" | "cache" | "model";
  // Why it no longer matches the current analysis. Empty when it does.
  stale: string[];
};

export type RoleSuggestion = { role: SuggestedRole; model: string };

export type StoredAi = {
  explanations: Record<string, ExplanationEntry>;
  // By file id.
  roles: Record<string, RoleSuggestion>;
  // Set when what is stored could not be read. The pane still works.
  problem: string | null;
};

export type ExplainOutcome = {
  explanation: { ok: true; entry: ExplanationEntry } | { ok: false; message: string };
  role: RoleSuggestion | null;
  // Things that went wrong around the request without stopping it.
  notes: string[];
};

// Whether the analysed commit is still the head of the default branch, as far
// as GitHub was actually asked. "unknown" is never treated as "current".
export type Revision =
  | { status: "current" }
  | { status: "moved"; headSha: string }
  | { status: "unknown"; reason: string };
