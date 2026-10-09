import {
  REFERENCE_KINDS,
  type DependencyEdge,
  type FileMetrics,
  type ReferenceKind,
} from "./contract";
import type { ReferenceSite } from "./references";
import type { Resolution } from "./resolve";
import { byText } from "./walk";

export type ResolvedReference = { source: string; site: ReferenceSite; resolution: Resolution };

const kindOrder = (kind: ReferenceKind) => REFERENCE_KINDS.indexOf(kind);

// Collapses internal references into one edge per source/target pair. A file
// that imports and re-exports the same module, or imports it twice, depends
// on it once; every statement that proves it is kept as evidence.
export function buildEdges(references: ResolvedReference[]): DependencyEdge[] {
  const edges = new Map<string, DependencyEdge>();
  for (const { source, site, resolution } of references) {
    if (resolution.status !== "internal" || site.specifier === null) continue;
    const key = `${source}\n${resolution.target}`;
    let edge = edges.get(key);
    if (!edge) {
      edge = { source, target: resolution.target, kinds: [], typeOnly: true, evidence: [] };
      edges.set(key, edge);
    }
    if (!edge.kinds.includes(site.kind)) edge.kinds.push(site.kind);
    edge.typeOnly = edge.typeOnly && site.typeOnly;
    edge.evidence.push({
      kind: site.kind,
      specifier: site.specifier,
      line: site.line,
      typeOnly: site.typeOnly,
      via: resolution.via,
    });
  }
  const sorted = [...edges.values()].sort(
    (a, b) => byText(a.source, b.source) || byText(a.target, b.target),
  );
  for (const edge of sorted) edge.kinds.sort((a, b) => kindOrder(a) - kindOrder(b));
  return sorted;
}

// Fan-in and fan-out, counted from the deduplicated edges. `files` must be
// every node, so files with no edges still get a row of zeros.
export function computeMetrics(files: string[], edges: DependencyEdge[]): FileMetrics[] {
  const metrics = new Map<string, FileMetrics>(
    files.map((file) => [file, { file, fanIn: 0, fanOut: 0 }]),
  );
  for (const edge of edges) {
    const source = metrics.get(edge.source);
    const target = metrics.get(edge.target);
    if (!source || !target) {
      throw new Error(`Edge ${edge.source} → ${edge.target} points at a file that is not a node.`);
    }
    source.fanOut += 1;
    target.fanIn += 1;
  }
  return [...metrics.values()];
}
