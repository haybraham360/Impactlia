import type { ParseStatus, ParserOutput, UnresolvedReason } from "@/parser/contract";
import { ROOT_LABEL, fileType } from "../repository-overview";

// What the canvas draws. Everything here is taken or counted from the parser
// output: file ids and edges are the parser's own, and a folder only decides
// which box a file is drawn in. Folding never removes a file or an edge.

export type GraphFile = {
  id: string;
  path: string;
  // The path relative to the folder the file is shown in.
  label: string;
  folder: string;
  fanIn: number;
  fanOut: number;
  type: string;
  lineCount: number;
  parseStatus: ParseStatus;
  parseErrors: { line: number; message: string }[];
  // Imports the parser read in this file that are not edges in the graph:
  // ones it could not resolve, and ones that resolve to an excluded file.
  unresolved: UnresolvedImport[];
  excluded: ExcludedImport[];
};

// null when the import path is an expression rather than a string.
export type UnresolvedImport = {
  specifier: string | null;
  line: number;
  reason: UnresolvedReason;
  detail: string;
};

export type ExcludedImport = {
  specifier: string | null;
  line: number;
  target: string;
  rule: string;
};

export type GraphFolder = {
  // The directory path; "" is the repository root.
  id: string;
  label: string;
  files: string[];
  // Dependencies that cross the folder's boundary, counted per file pair.
  fanIn: number;
  fanOut: number;
  // Dependencies between two files that are both in this folder.
  internal: number;
};

export type GraphEdge = { source: string; target: string; typeOnly: boolean };

export type GraphModel = {
  files: GraphFile[];
  folders: GraphFolder[];
  edges: GraphEdge[];
  // A directory with fewer files than this is shown inside its parent.
  foldThreshold: number;
};

// Plain code-point order, so the result does not depend on locale.
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const parentOf = (directory: string) =>
  directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : "";

// How many folders the canvas aims to show. It grows with the square root of
// the repository, so a large repository gets more folders, but not so many
// that none can be read.
function folderBudget(fileCount: number): number {
  return Math.max(6, Math.round(1.5 * Math.sqrt(fileCount)));
}

// Walks the real directory tree bottom-up. A directory holding at least
// `threshold` files that no deeper folder has claimed becomes a folder of its
// own; otherwise its files pass up to its parent.
function fold(
  filesByDirectory: Map<string, string[]>,
  children: Map<string, string[]>,
  threshold: number,
): Map<string, string[]> {
  const folders = new Map<string, string[]>();
  function unclaimed(directory: string): string[] {
    const files = [
      ...(filesByDirectory.get(directory) ?? []),
      ...(children.get(directory) ?? []).flatMap(unclaimed),
    ];
    if (directory !== "" && files.length >= threshold) {
      folders.set(directory, files);
      return [];
    }
    return files;
  }
  const atRoot = unclaimed("");
  if (atRoot.length > 0) folders.set("", atRoot);
  return folders;
}

// The fewest trailing path segments that tell each folder apart from the rest.
function shortLabels(directories: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const directory of directories) {
    if (directory === "") {
      labels.set(directory, ROOT_LABEL);
      continue;
    }
    const segments = directory.split("/");
    let label = directory;
    for (let take = 1; take <= segments.length; take += 1) {
      const candidate = segments.slice(-take).join("/");
      // Anywhere in another path counts, not only at its end: "bun" next to
      // "bun/src" would be unique but still easy to mistake for it.
      const clashes = directories.some(
        (other) => other !== directory && `/${other}/`.includes(`/${candidate}/`),
      );
      if (!clashes) {
        label = candidate;
        break;
      }
    }
    labels.set(directory, label);
  }
  return labels;
}

export function buildGraphModel(output: ParserOutput): GraphModel {
  const filesByDirectory = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const known = new Set<string>([""]);
  for (const file of output.files) {
    const files = filesByDirectory.get(file.folder);
    if (files) files.push(file.id);
    else filesByDirectory.set(file.folder, [file.id]);
    for (let directory = file.folder; !known.has(directory); directory = parentOf(directory)) {
      known.add(directory);
      const parent = parentOf(directory);
      const siblings = children.get(parent);
      if (siblings) siblings.push(directory);
      else children.set(parent, [directory]);
    }
  }
  for (const list of children.values()) list.sort(byText);

  // The smallest threshold that fits the budget, so no more is folded away
  // than the repository's size requires.
  const budget = folderBudget(output.files.length);
  let foldThreshold = 1;
  let folded = fold(filesByDirectory, children, foldThreshold);
  while (folded.size > budget && foldThreshold < output.files.length) {
    foldThreshold += 1;
    folded = fold(filesByDirectory, children, foldThreshold);
  }

  const directories = [...folded.keys()].sort(byText);
  const labels = shortLabels(directories);
  const folderOf = new Map<string, string>();
  for (const [directory, files] of folded) {
    for (const file of files) folderOf.set(file, directory);
  }
  const folderFor = (file: string): string => {
    const folder = folderOf.get(file);
    if (folder === undefined) throw new Error(`${file} was not placed in a folder.`);
    return folder;
  };

  const counts = new Map(
    directories.map((directory) => [directory, { fanIn: 0, fanOut: 0, internal: 0 }]),
  );
  const countsFor = (directory: string) => {
    const entry = counts.get(directory);
    if (!entry) throw new Error(`${directory} is not a folder.`);
    return entry;
  };
  for (const edge of output.edges) {
    const source = folderFor(edge.source);
    const target = folderFor(edge.target);
    if (source === target) {
      countsFor(source).internal += 1;
    } else {
      countsFor(source).fanOut += 1;
      countsFor(target).fanIn += 1;
    }
  }

  const metrics = new Map(output.metrics.map((metric) => [metric.file, metric]));

  const unresolved = new Map<string, UnresolvedImport[]>();
  const excluded = new Map<string, ExcludedImport[]>();
  for (const reference of output.unlinkedReferences) {
    const { source, specifier, line } = reference;
    if (reference.status === "unresolved") {
      const entry = { specifier, line, reason: reference.reason, detail: reference.detail };
      const list = unresolved.get(source);
      if (list) list.push(entry);
      else unresolved.set(source, [entry]);
    } else if (reference.status === "excluded") {
      const entry = { specifier, line, target: reference.target, rule: reference.rule };
      const list = excluded.get(source);
      if (list) list.push(entry);
      else excluded.set(source, [entry]);
    }
  }

  return {
    files: output.files.map((file) => {
      const folder = folderFor(file.id);
      const metric = metrics.get(file.id);
      if (!metric) throw new Error(`${file.id} has no metrics.`);
      return {
        id: file.id,
        path: file.path,
        label: folder === "" ? file.path : file.path.slice(folder.length + 1),
        folder,
        fanIn: metric.fanIn,
        fanOut: metric.fanOut,
        type: fileType(file),
        lineCount: file.lineCount,
        parseStatus: file.parseStatus,
        parseErrors: file.parseErrors,
        unresolved: unresolved.get(file.id) ?? [],
        excluded: excluded.get(file.id) ?? [],
      };
    }),
    folders: directories.map((directory) => ({
      id: directory,
      label: labels.get(directory) ?? directory,
      files: [...(folded.get(directory) ?? [])].sort(byText),
      ...countsFor(directory),
    })),
    edges: output.edges.map(({ source, target, typeOnly }) => ({ source, target, typeOnly })),
    foldThreshold,
  };
}
