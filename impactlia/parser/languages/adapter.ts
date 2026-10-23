import type { Language, ParseStatus, ResolutionConfig } from "../contract";
import type { ResolvedReference } from "../graph";
import type { WalkResult } from "../walk";

// What one language adds to the parser. The parser walks the repository,
// reads every source file's bytes, and gives each adapter the files of its
// languages. The adapter says whether each one parsed and which references it
// makes, each already resolved to a file in the repository, to something
// outside it, or to an honest "unresolved". Edges, metrics, roles and
// coverage are built from that by the parser, the same way for every
// language.
//
// An adapter never runs repository code and never reads outside `root`. A
// reference it cannot resolve from the files is reported as unresolved,
// never guessed.

export type FileReading = {
  parseStatus: ParseStatus;
  parseErrors: { line: number; message: string }[];
  // Empty for a file that failed to parse: references read from a recovered
  // tree could be artefacts of the recovery.
  references: ResolvedReference[];
};

export type LanguageContext = {
  // The repository's real path on disk.
  root: string;
  walk: WalkResult;
  // The files of this adapter's languages, sorted, with their text.
  files: string[];
  texts: ReadonlyMap<string, string>;
  // Which of its languages a file is. Usually its extension says; a C or C++
  // header (.h) is decided by the repository (see parse-repository.ts).
  languageOf: (file: string) => Language;
  // Updating a stored graph (see parse-repository.ts): files of this
  // adapter's languages that did not change, with the references the stored
  // graph read out of them. They are not parsed again; their references are
  // resolved again against the repository as it is now. Empty otherwise.
  stored: ReadonlyMap<string, ResolvedReference[]>;
};

export type LanguageReading = {
  // One entry for every file in the context, parsed or stored. A stored
  // file's parse status is the stored graph's; only its references count.
  files: Map<string, FileReading>;
  // Configuration files that steered resolution, and anything wrong with them.
  resolutionConfigs: ResolutionConfig[];
};

export type LanguageAdapter = {
  languages: readonly Language[];
  read: (context: LanguageContext) => LanguageReading;
};

export const PARSE_ERROR_LIMIT = 5;

// Raised when a stored graph cannot be updated exactly and the repository
// has to be read in full instead. The message says why, for the report.
export class OverlayUnsupported extends Error {}

// A stored file's references grouped back into the statements that made
// them: a Go import is stored once per file of the package it names, and is
// one statement to resolve again.
export function storedStatements(references: readonly ResolvedReference[]): ResolvedReference[][] {
  const groups = new Map<string, ResolvedReference[]>();
  for (const reference of references) {
    const { kind, specifier, line, typeOnly } = reference.site;
    const key = `${kind}\n${specifier ?? ""}\n${line}\n${typeOnly}`;
    groups.set(key, [...(groups.get(key) ?? []), reference]);
  }
  return [...groups.values()];
}

// A statement resolved again into one reference per resolution.
export function restated(
  statement: readonly ResolvedReference[],
  resolutions: readonly ResolvedReference["resolution"][],
): ResolvedReference[] {
  const [{ source, site }] = statement;
  return resolutions.map((resolution) => ({ source, site, resolution }));
}

// For a language whose references cannot be resolved again from what was
// stored (Java, C#, PHP: a reference there depends on what every file of
// the language declares): its stored references stand while none of its
// files changed, and the update is refused when any did.
export function keepStored(label: string, context: LanguageContext): Map<string, FileReading> | null {
  const { files, stored } = context;
  if (stored.size === 0) return null;
  const present = new Set(context.walk.sourceFiles);
  const gone = [...stored.values()]
    .flat()
    .some(({ resolution }) => resolution.status === "internal" && !present.has(resolution.target));
  if (files.length > 0 || gone) {
    throw new OverlayUnsupported(
      `${label} files were added, changed or removed, and ${label} references depend on what every ${label} file declares, so they cannot be updated file by file.`,
    );
  }
  return new Map(
    [...stored].map(([file, references]) => [file, { parseStatus: "parsed", parseErrors: [], references }]),
  );
}
