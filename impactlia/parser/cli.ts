import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ParserOutput, ReferenceCounts } from "./contract";
import { parseRepository } from "./parse-repository";
import { readParserOutput } from "./validate";

const USAGE = "Usage: pnpm parse <repository-directory> [--out <file.json>]";
const TOP_FILES = 5;

function readArguments(argv: string[]): { directory: string; out: string | null } {
  let directory: string | null = null;
  let out: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") {
      out = argv[index + 1] ?? null;
      if (out === null) throw new Error(`--out needs a file path.\n${USAGE}`);
      index += 1;
    } else if (argument.startsWith("--") || directory !== null) {
      throw new Error(`Unexpected argument "${argument}".\n${USAGE}`);
    } else {
      directory = argument;
    }
  }
  if (directory === null) throw new Error(USAGE);
  return { directory, out };
}

function row(label: string, value: number | string, note = ""): string {
  return `  ${label.padEnd(24)}${String(value).padStart(7)}${note ? `   ${note}` : ""}`;
}

function countsLine(counts: ReferenceCounts): string {
  return `${counts.encountered} encountered · ${counts.internal} internal · ${counts.external} external · ${counts.excluded} excluded · ${counts.unresolved} unresolved`;
}

function summary(output: ParserOutput): string[] {
  const { coverage } = output;
  const lines = [
    `Parser output schema v${output.schemaVersion} · adapter: ${output.adapter}`,
    "",
    "Files",
    row("encountered", coverage.files.encountered, "in the directories that were walked"),
    row("included", coverage.files.included),
    row("parsed", coverage.files.parsed),
    row("failed to parse", coverage.files.failed),
    row("excluded", coverage.files.excluded),
    row("directories excluded", coverage.directoriesExcluded, "not descended, contents not counted"),
    "",
    "Excluded by rule",
    ...coverage.excludedByRule.map((entry) =>
      row(entry.rule, entry.files, `files, ${entry.directories} directories`),
    ),
    "",
    "References",
    row("encountered", coverage.references.encountered),
    row("internal", coverage.references.internal, `→ ${coverage.edges} edges after deduplication`),
    row("external", coverage.references.external),
    row("excluded", coverage.references.excluded),
    row("unresolved", coverage.references.unresolved),
    "",
    "References by kind",
    ...coverage.referencesByKind.map(({ kind, ...counts }) => `  ${kind.padEnd(18)}${countsLine(counts)}`),
  ];

  const failed = output.files.filter((file) => file.parseStatus === "failed");
  if (failed.length > 0) {
    lines.push("", "Files that failed to parse");
    for (const file of failed) {
      const first = file.parseErrors[0];
      lines.push(`  ${file.path}:${first.line}  ${first.message}`);
    }
  }

  if (coverage.unresolvedByReason.length > 0) {
    lines.push("", "Unresolved references");
    for (const group of coverage.unresolvedByReason) {
      lines.push(`  ${group.reason} (${group.count})`);
      for (const example of group.examples) {
        lines.push(
          `    ${example.source}:${example.line}  ${example.specifier ?? "(expression)"}`,
          `      ${example.detail}`,
        );
      }
    }
  }

  const excludedTargets = output.unlinkedReferences.flatMap((reference) =>
    reference.status === "excluded" ? [reference] : [],
  );
  if (excludedTargets.length > 0) {
    lines.push("", "References into excluded paths");
    for (const reference of excludedTargets) {
      lines.push(
        `  ${reference.source}:${reference.line}  ${reference.specifier} → ${reference.target} (${reference.rule})`,
      );
    }
  }

  const troubled = output.resolutionConfigs.filter((config) => config.problems.length > 0);
  if (troubled.length > 0) {
    lines.push("", "Config problems that can affect resolution");
    for (const config of troubled) {
      for (const problem of config.problems) lines.push(`  ${config.path}: ${problem}`);
    }
  }

  const busiest = [...output.metrics]
    .filter((metric) => metric.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, TOP_FILES);
  if (busiest.length > 0) {
    lines.push("", "Highest fan-in");
    for (const metric of busiest) {
      lines.push(`  ${metric.file}  fan-in ${metric.fanIn}, fan-out ${metric.fanOut}`);
    }
  }
  return lines;
}

function main(): void {
  const { directory, out } = readArguments(process.argv.slice(2));
  const output = parseRepository(directory);
  const json = `${JSON.stringify(output, null, 2)}\n`;

  console.log(`Repository: ${path.resolve(directory)}`);
  console.log(summary(output).join("\n"));
  // The same repository state always gives the same hash.
  console.log(`\nOutput SHA-256: ${createHash("sha256").update(json).digest("hex")}`);

  if (out !== null) {
    fs.writeFileSync(out, json);
    // Read the file back rather than trusting what was just written.
    const reread: unknown = JSON.parse(fs.readFileSync(out, "utf8"));
    const valid = readParserOutput(reread);
    if (JSON.stringify(valid) !== JSON.stringify(output)) {
      throw new Error(`${out} did not survive being written and read back unchanged.`);
    }
    console.log(`Wrote ${path.resolve(out)} (${json.length} bytes), read it back and validated it.`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
