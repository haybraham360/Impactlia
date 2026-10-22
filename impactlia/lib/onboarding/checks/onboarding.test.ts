import assert from "node:assert/strict";
import { test } from "node:test";
import { startStepFor, workspaceNameFor } from "../start";

// Run with `pnpm check:onboarding`. What the database decides (one member
// row per verified user, no row for anyone else, nothing readable without a
// session) is checked by supabase/tests/members.test.sql under
// `pnpm check:database`.

test("a new person with no workspace gets one made, with nothing to fill in", () => {
  assert.equal(startStepFor({ activeOrganization: false, memberships: 0 }), "create");
});

test("someone with exactly one workspace goes straight into it", () => {
  assert.equal(startStepFor({ activeOrganization: false, memberships: 1 }), "activate");
});

test("a returning person with a workspace active is not set up again", () => {
  for (const memberships of [0, 1, 2, 7]) {
    assert.equal(startStepFor({ activeOrganization: true, memberships }), "finish");
  }
});

test("only someone with several workspaces is asked to choose", () => {
  assert.equal(startStepFor({ activeOrganization: false, memberships: 2 }), "choose");
  assert.equal(startStepFor({ activeOrganization: false, memberships: 5 }), "choose");
});

test("a workspace is named after the person, or plainly when there is no name", () => {
  assert.equal(workspaceNameFor("Ada"), "Ada's workspace");
  assert.equal(workspaceNameFor("  Ada   Lovelace "), "Ada Lovelace's workspace");
  assert.equal(workspaceNameFor(null), "My workspace");
  assert.equal(workspaceNameFor(undefined), "My workspace");
  assert.equal(workspaceNameFor("   "), "My workspace");
  // Names from any language are kept as written.
  assert.equal(workspaceNameFor("Zoë"), "Zoë's workspace");
  assert.equal(workspaceNameFor("美咲"), "美咲's workspace");
});

test("control characters and very long names do not reach the workspace name", () => {
  assert.equal(workspaceNameFor("Ada\u0000​\nBob"), "Ada Bob's workspace");
  const long = workspaceNameFor("x".repeat(500));
  assert.ok(long.length <= 40 + "'s workspace".length);
});
