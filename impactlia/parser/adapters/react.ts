import {
  dependencyEvidence,
  emptyAnalysis,
  type AdapterFile,
  type FrameworkAdapter,
} from "../adapter";
import type { FileRole } from "../contract";
import { supportingRole } from "../generic-roles";
import { COMMONJS_MODULE, containsJsx, readExports } from "./syntax";

// React, for repositories that no more specific adapter claims.
//
// Detected by: a package.json that lists "react".
//
// Roles, first match wins:
//   test, declaration, config   by name, as in every repository
//   component                   the file contains JSX, and exports a function
//                               or class under a capitalised name or as its
//                               default. A capitalised constant counts when it
//                               is assigned a function or a call (memo,
//                               forwardRef, styled). `module.exports = value`
//                               counts as the default export.
//   hook                        the file exports a function, or a constant
//                               assigned a function or call, named `use`
//                               followed by a capital letter or digit
//
// No routes. A client-side router's routes are built in code at runtime, which
// is not something a file convention or a decorator states.

const COMPONENT_KINDS = new Set(["function", "class", "call"]);
const HOOK_KINDS = new Set(["function", "call"]);

// Also used by the Next.js adapter, whose components and hooks are React's.
export function reactRole(file: AdapterFile): FileRole | null {
  if (!file.syntax) return null;
  const { bindings } = readExports(file.syntax);

  const isDefault = (name: string) => name === "default" || name === COMMONJS_MODULE;
  if (containsJsx(file.syntax)) {
    const component = bindings.find((binding) =>
      isDefault(binding.name)
        ? binding.kind !== "value"
        : COMPONENT_KINDS.has(binding.kind) && /^[A-Z]/.test(binding.name),
    );
    if (component) {
      const named = isDefault(component.name) ? component.local : component.name;
      return {
        id: "component",
        reason:
          isDefault(component.name)
            ? `Contains JSX and has a default export${named ? ` (${named})` : ""}.`
            : `Contains JSX and exports ${named}.`,
        line: component.line,
      };
    }
  }

  const hook = bindings.find(
    (binding) => HOOK_KINDS.has(binding.kind) && /^use[A-Z0-9]/.test(binding.name),
  );
  if (hook) {
    return { id: "hook", reason: `Exports ${hook.name}.`, line: hook.line };
  }
  return null;
}

export const reactAdapter: FrameworkAdapter = {
  name: "react",
  detect: (manifests) => dependencyEvidence(manifests, "react"),
  analyse(files) {
    const analysis = emptyAnalysis();
    for (const file of files) {
      const role = supportingRole(file) ?? reactRole(file);
      if (role) analysis.roles.set(file.path, role);
    }
    analysis.notes.push({
      file: null,
      line: null,
      detail:
        "The React adapter extracts no routes. A client-side router defines its routes in code at runtime, which static analysis of file conventions cannot read exactly.",
    });
    return analysis;
  },
};
