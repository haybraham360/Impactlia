// The one place the model and the prompt versions are named. Both are part of
// every cache key, so changing either one here stops results written under the
// old value from being served, and touches nothing else.

// An exact, dated snapshot. A moving alias such as "gpt-4.1-mini" would let
// the provider change what answers under the same cache key.
export const MODEL = "gpt-4.1-mini-2025-04-14";

if (!/-\d{4}-\d{2}-\d{2}$/.test(MODEL)) {
  throw new Error(
    `The AI model "${MODEL}" is not pinned to a dated version. Set MODEL in lib/ai/config.ts to an exact snapshot.`,
  );
}

export const TASKS = ["file-explanation", "folder-explanation", "role-classification"] as const;
export type AiTask = (typeof TASKS)[number];

// Bump a task's version whenever its prompt, its evidence shape or one of its
// size limits changes.
export const PROMPT_VERSIONS: Record<AiTask, string> = {
  "file-explanation": "file-1",
  "folder-explanation": "folder-1",
  "role-classification": "role-1",
};

export const TASK_LABELS: Record<AiTask, string> = {
  "file-explanation": "File explanation",
  "folder-explanation": "Folder explanation",
  "role-classification": "Role suggestion",
};
