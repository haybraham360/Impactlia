import { ROLES, type RoleId } from "../../parser/roles";
import { HIGH_FAN_IN_DEPENDENTS } from "../graph/insights";
import { MAX_DEPTH } from "../graph/traverse";
import type { RiskLevel, SignalId } from "./report";

// The whole risk methodology. Every threshold is a fixed number written here,
// so a level can be checked by counting, and the report page prints these
// rules next to the signals they produced.
//
// A level is a way to decide what to look at first. It is not a probability
// that anything breaks, and no rule here says a file is wrong.

// How far the blast radius is followed. The traversal's own ceiling.
export const IMPACT_DEPTH = MAX_DEPTH;

export const DIRECT_DEPENDENTS_MEDIUM = 3;
// The same number the repository map uses for "highly depended-on".
export const DIRECT_DEPENDENTS_HIGH = HIGH_FAN_IN_DEPENDENTS;

export const REACH_MEDIUM = 10;
export const REACH_HIGH = 50;

export const SHARED_MODULE_DEPENDENTS = HIGH_FAN_IN_DEPENDENTS;

// Roles that receive requests, guard them, or define stored data. Only a role
// a framework adapter assigned from the file's path or syntax counts; pages
// and components are left out because most pull requests touch one.
export const CRITICAL_ROLES: readonly RoleId[] = [
  "api-endpoint",
  "server-action",
  "middleware",
  "controller",
  "entity",
  "express-route-module",
  "express-controller",
  "express-middleware",
  "express-model",
];

export const SIGNALS: Record<SignalId, { label: string; rule: string }> = {
  "direct-dependents": {
    label: "A changed file is imported directly by many files",
    rule: `Counts the files that import each changed file. Medium when any changed file has ${DIRECT_DEPENDENTS_MEDIUM} or more, high at ${DIRECT_DEPENDENTS_HIGH} or more.`,
  },
  "transitive-reach": {
    label: "The change reaches files through chains of imports",
    rule: `Counts the distinct files that import a changed file directly or through up to ${IMPACT_DEPTH} imports, each once. Low from 1, medium from ${REACH_MEDIUM}, high from ${REACH_HIGH}.`,
  },
  "shared-module-reached": {
    label: "The change reaches a highly depended-on module",
    rule: `Medium when a potentially affected file is itself imported by ${SHARED_MODULE_DEPENDENTS} or more files.`,
  },
  "critical-role": {
    label: "The change touches a request-handling or data-model file",
    rule: `Medium when a changed file has one of these roles, as assigned by a framework adapter: ${CRITICAL_ROLES.map((role) => ROLES[role].label).filter((label, at, all) => all.indexOf(label) === at).join(", ")}.`,
  },
  "incomplete-coverage": {
    label: "Part of the change or of the graph could not be analysed",
    rule: "Medium when the list of changed files is incomplete, or a changed source file was removed, could not be parsed or is missing from the graph. Low when only other gaps exist: changed files of a kind the graph does not cover, or imports elsewhere in the repository that could not be resolved.",
  },
};

export const LEVEL_RULE =
  "The label is the highest level among the signals that were triggered, or Low when none was. When no changed file could be matched to the graph there was nothing to measure, and the label is “Insufficient evidence” instead.";

const ORDER: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

export function highestLevel(levels: readonly RiskLevel[]): RiskLevel | null {
  let highest: RiskLevel | null = null;
  for (const level of levels) {
    if (highest === null || ORDER[level] > ORDER[highest]) highest = level;
  }
  return highest;
}
