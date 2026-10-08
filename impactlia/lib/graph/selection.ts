import { linkId } from "./layout";
import type { GraphEdge, GraphModel } from "./model";

export type Selection = { kind: "file" | "folder"; id: string };

// The selection's real dependency relationships, read straight from the edge
// list. "Incoming" is what depends on the selection; "outgoing" is what the
// selection depends on.
export type Relations = {
  selected: ReadonlySet<string>;
  incoming: GraphEdge[];
  outgoing: GraphEdge[];
  // Files on the far end of those edges.
  dependents: ReadonlySet<string>;
  dependencies: ReadonlySet<string>;
  // Folder-to-folder lines that carry at least one of those edges.
  incomingLinks: ReadonlySet<string>;
  outgoingLinks: ReadonlySet<string>;
  // Folders holding the selection or anything related to it.
  folders: ReadonlySet<string>;
  // How many of each folder's files are dependents or dependencies, so a
  // closed folder can say why it is still bright.
  dependentsIn: ReadonlyMap<string, number>;
  dependenciesIn: ReadonlyMap<string, number>;
};

export function relate(model: GraphModel, selection: Selection): Relations {
  const folderOf = new Map(model.files.map((file) => [file.id, file.folder]));
  const folder = (file: string) => folderOf.get(file) ?? "";
  const selected = new Set(
    selection.kind === "file"
      ? [selection.id]
      : model.files.filter((file) => file.folder === selection.id).map((file) => file.id),
  );

  // An edge with both ends inside the selection is neither incoming nor
  // outgoing: it does not cross the selection's boundary.
  const incoming = model.edges.filter(
    (edge) => selected.has(edge.target) && !selected.has(edge.source),
  );
  const outgoing = model.edges.filter(
    (edge) => selected.has(edge.source) && !selected.has(edge.target),
  );

  const folders = new Set([...selected].map(folder));
  const links = (edges: GraphEdge[]) => {
    const ids = new Set<string>();
    for (const edge of edges) {
      const source = folder(edge.source);
      const target = folder(edge.target);
      folders.add(source).add(target);
      if (source !== target) ids.add(linkId(source, target));
    }
    return ids;
  };

  const dependents = new Set(incoming.map((edge) => edge.source));
  const dependencies = new Set(outgoing.map((edge) => edge.target));
  const perFolder = (files: ReadonlySet<string>) => {
    const counts = new Map<string, number>();
    for (const file of files) counts.set(folder(file), (counts.get(folder(file)) ?? 0) + 1);
    return counts;
  };

  return {
    selected,
    incoming,
    outgoing,
    dependents,
    dependencies,
    dependentsIn: perFolder(dependents),
    dependenciesIn: perFolder(dependencies),
    incomingLinks: links(incoming),
    outgoingLinks: links(outgoing),
    folders,
  };
}
