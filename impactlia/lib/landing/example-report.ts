import type { RiskLevel, SignalId } from "@/lib/impact/report";
import {
  DIRECT_DEPENDENTS_HIGH,
  DIRECT_DEPENDENTS_MEDIUM,
  REACH_HIGH,
  REACH_MEDIUM,
  SIGNALS,
  highestLevel,
} from "@/lib/impact/risk";
import { affectedFiles, changedFiles, exampleEdges } from "@/lib/landing/example";

// The example's risk signals, measured from the example's own files and edges
// with the product's real thresholds and wording. The landing page does not
// get its own scoring model: if the methodology changes, this changes with it.

export type ExampleSignal = {
  id: SignalId;
  label: string;
  level: RiskLevel;
  fact: string;
};

export const levelLabel: Record<RiskLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const directCounts = changedFiles.map((file) => ({
  file,
  count: exampleEdges.filter((edge) => edge.target === file.id).length,
}));
const widest = directCounts.reduce((best, entry) => (entry.count > best.count ? entry : best));

function directLevel(count: number): RiskLevel | null {
  if (count >= DIRECT_DEPENDENTS_HIGH) return "high";
  if (count >= DIRECT_DEPENDENTS_MEDIUM) return "medium";
  return null;
}

function reachLevel(count: number): RiskLevel | null {
  if (count >= REACH_HIGH) return "high";
  if (count >= REACH_MEDIUM) return "medium";
  if (count >= 1) return "low";
  return null;
}

const measured: (ExampleSignal | null)[] = [
  (() => {
    const level = directLevel(widest.count);
    return level
      ? {
          id: "direct-dependents",
          label: SIGNALS["direct-dependents"].label,
          level,
          fact: `${widest.file.name} is imported directly by ${widest.count} files.`,
        }
      : null;
  })(),
  (() => {
    const level = reachLevel(affectedFiles.length);
    return level
      ? {
          id: "transitive-reach",
          label: SIGNALS["transitive-reach"].label,
          level,
          fact: `${affectedFiles.length} files import a changed file, directly or through another file.`,
        }
      : null;
  })(),
  {
    id: "incomplete-coverage",
    label: SIGNALS["incomplete-coverage"].label,
    level: "low",
    fact: "One import elsewhere in the repository could not be resolved.",
  },
];

export const exampleSignals = measured.filter((signal) => signal !== null);

// Never null here: the example always triggers at least one signal.
export const exampleLevel: RiskLevel =
  highestLevel(exampleSignals.map((signal) => signal.level)) ?? "low";

export const LEVEL_SUMMARY =
  "The level is the highest one among the signals that were triggered. It decides what to look at first. It is not a prediction that anything breaks.";

// Shaped like the product's suggested checks: what to do, and the computed
// fact behind it.
export const exampleChecks = [
  {
    file: "invoice.ts",
    body: "Check invoice.ts still behaves correctly with both changes.",
    reason: "It imports both changed files.",
  },
  {
    file: "checkout.ts",
    body: "Run the tests for checkout.ts and refund.ts.",
    reason: "Both import payment.ts directly.",
  },
  {
    file: "receipt.ts",
    body: "Look at receipt.ts if what invoice.ts produces has changed.",
    reason: "It is reached through invoice.ts.",
  },
];
