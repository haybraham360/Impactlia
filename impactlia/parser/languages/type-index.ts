// Which file declares which type, for languages where an import or a
// reference names a type rather than a file: Java (packages), C#
// (namespaces) and PHP (namespaces). Built from what each file declares, as
// its own parse read it; nothing is inferred from a file's path.
//
// A namespace is written with dots here whatever the language writes
// ("App\Models" is "App.Models"), and "" is the global namespace.

export type Declarations = { namespace: string; types: string[] }[];

export type TypeIndex = {
  // The files that declare `namespace.type`; several for a C# partial class.
  filesOf: (qualified: string) => string[];
  // The types a namespace declares, each with its files.
  typesIn: (namespace: string) => ReadonlyMap<string, string[]>;
  // Whether any file declares this namespace, or one inside it.
  declaresNamespace: (namespace: string) => boolean;
};

export const qualify = (namespace: string, name: string) => (namespace === "" ? name : `${namespace}.${name}`);

export function buildTypeIndex(byFile: ReadonlyMap<string, Declarations>): TypeIndex {
  const byNamespace = new Map<string, Map<string, string[]>>();
  const namespaces = new Set<string>();
  for (const [file, declarations] of [...byFile].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const { namespace, types } of declarations) {
      for (let at = namespace; at !== ""; at = at.includes(".") ? at.slice(0, at.lastIndexOf(".")) : "") {
        namespaces.add(at);
      }
      const types_ = byNamespace.get(namespace) ?? new Map<string, string[]>();
      for (const type of types) {
        const files = types_.get(type) ?? [];
        if (!files.includes(file)) files.push(file);
        types_.set(type, files);
      }
      byNamespace.set(namespace, types_);
    }
  }
  const empty: ReadonlyMap<string, string[]> = new Map();
  return {
    filesOf(qualified) {
      const dot = qualified.lastIndexOf(".");
      const namespace = dot === -1 ? "" : qualified.slice(0, dot);
      return byNamespace.get(namespace)?.get(qualified.slice(dot + 1)) ?? [];
    },
    typesIn: (namespace) => byNamespace.get(namespace) ?? empty,
    declaresNamespace: (namespace) => namespaces.has(namespace),
  };
}
