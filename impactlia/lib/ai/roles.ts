// The roles a model may suggest for a file no deterministic rule placed.
//
// These are a separate vocabulary from the parser's roles on purpose. A
// suggestion is shown beside the file's real role, labelled as a suggestion,
// and is never written into the parser output: route tables, role filters and
// edges are decided by adapters alone. Nothing here is structural or routable,
// so there is no way to suggest that a file is a page, a route or a controller.

export const SUGGESTED_ROLES = [
  "service",
  "repository",
  "model",
  "util",
  "config",
  "component",
  "hook",
] as const;
export type SuggestedRole = (typeof SUGGESTED_ROLES)[number];

export const SUGGESTED_ROLE_LABELS: Record<SuggestedRole, string> = {
  service: "Service",
  repository: "Repository (data access)",
  model: "Model",
  util: "Utility",
  config: "Configuration",
  component: "Component",
  hook: "Hook",
};

// The whole of the validation: the answer, trimmed of whitespace and case, is
// exactly one allowed role or it is nothing. A sentence, two roles, "unknown"
// or a role outside the list all come back null, and the file stays generic.
export function readSuggestedRole(answer: string): SuggestedRole | null {
  const word = answer.trim().toLowerCase();
  return SUGGESTED_ROLES.find((role) => role === word) ?? null;
}
