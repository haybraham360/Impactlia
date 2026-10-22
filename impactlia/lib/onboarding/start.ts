// What the start page does for a signed-in person, decided from what Clerk
// says about them. Pure, so every case is checked in lib/onboarding/checks.
//
// Everything in Impactlia belongs to a workspace (a Clerk organization), so
// a session needs one before anything else works. A new person gets one
// made for them rather than a form to fill in; someone with exactly one
// goes straight into it; only someone with several is asked which.

export type StartStep =
  // A workspace is active: record the visit and open the app.
  | "finish"
  // No workspace at all: make one, then finish.
  | "create"
  // Exactly one: make it active, then finish.
  | "activate"
  // Several: let the person choose.
  | "choose";

export function startStepFor(state: { activeOrganization: boolean; memberships: number }): StartStep {
  if (state.activeOrganization) return "finish";
  if (state.memberships === 0) return "create";
  if (state.memberships === 1) return "activate";
  return "choose";
}

const NAME_LENGTH = 40;

// The name of a workspace made for someone, from the first name they gave
// Clerk, if any. Renamed later on the Team page.
export function workspaceNameFor(firstName: string | null | undefined): string {
  const name = (firstName ?? "")
    // Line breaks and tabs become spaces; other invisible characters go.
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, NAME_LENGTH)
    .trim();
  return name === "" ? "My workspace" : `${name}'s workspace`;
}
