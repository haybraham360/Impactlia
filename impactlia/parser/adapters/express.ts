import {
  dependencyEvidence,
  emptyAnalysis,
  type AdapterFile,
  type FrameworkAdapter,
} from "../adapter";
import type { FileRole } from "../contract";
import { supportingRole } from "../generic-roles";
import type { RoleId } from "../roles";

// Express.
//
// Detected by: a package.json that lists "express".
//
// Roles, first match wins:
//   test, declaration, config   by name, as in every repository
//   by directory                the nearest enclosing folder, inside the
//                               package, with one of these names:
//
//     route, routes, router, routers          route module
//     controller, controllers                 controller
//     middleware, middlewares                 middleware
//     service, services                       service
//     model, models                           model
//
// Folder names are matched whole and in lower case. When a file sits under
// two of them (routes/middleware/auth.js) the deeper one decides. A file under
// none of them keeps a generic role: file names such as user.controller.js
// are not read, and neither is what the file does.
//
// No routes. An Express route is assembled at runtime from routers mounted on
// other routers under paths held in variables, so its full pattern is not
// written anywhere a static reader can take it from exactly.

const DIRECTORY_ROLES: { names: string[]; id: RoleId }[] = [
  { names: ["route", "routes", "router", "routers"], id: "express-route-module" },
  { names: ["controller", "controllers"], id: "express-controller" },
  { names: ["middleware", "middlewares"], id: "express-middleware" },
  { names: ["service", "services"], id: "express-service" },
  { names: ["model", "models"], id: "express-model" },
];

function directoryRole(file: AdapterFile): FileRole | null {
  const relative =
    file.packageRoot === "" ? file.path : file.path.slice(file.packageRoot.length + 1);
  const folders = relative.split("/").slice(0, -1);
  for (const folder of folders.reverse()) {
    const match = DIRECTORY_ROLES.find((entry) => entry.names.includes(folder));
    if (match) {
      return { id: match.id, reason: `Inside a folder named ${folder}/.`, line: null };
    }
  }
  return null;
}

export const expressAdapter: FrameworkAdapter = {
  name: "express",
  detect: (manifests) => dependencyEvidence(manifests, "express"),
  analyse(files) {
    const analysis = emptyAnalysis();
    for (const file of files) {
      const role = supportingRole(file) ?? directoryRole(file);
      if (role) analysis.roles.set(file.path, role);
    }
    analysis.notes.push({
      file: null,
      line: null,
      detail:
        "Express routes are not extracted. They are put together at runtime from routers, mount paths and middleware, so a full pattern cannot be read from the source exactly. An empty table here does not mean the application has no routes.",
    });
    return analysis;
  },
};
