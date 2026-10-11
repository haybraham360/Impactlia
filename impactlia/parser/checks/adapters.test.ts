import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { frameworkAdapters } from "../adapters";
import type { ParserOutput } from "../contract";
import { parseRepository } from "../parse-repository";
import { readParserOutput } from "../validate";

// Run with `pnpm check:adapters`. Each repository is written out below, file
// by file, so every expected role and route can be read off the test.

function analyse(files: Record<string, string>): ParserOutput {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-adapters-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      fs.writeFileSync(path.join(directory, file), content);
    }
    const output = parseRepository(directory, frameworkAdapters);
    // What is stored is what has to hold together.
    return readParserOutput(JSON.parse(JSON.stringify(output)));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const manifest = (...dependencies: string[]) =>
  JSON.stringify({ name: "fixture", dependencies: Object.fromEntries(dependencies.map((d) => [d, "1"])) });
const roleOf = (output: ParserOutput, file: string) =>
  output.files.find((entry) => entry.path === file)?.role.id;
const routesOf = (output: ParserOutput) =>
  output.routes.map((route) => `${route.method ?? "PAGE"} ${route.pattern} <- ${route.file}`);
const omittedIn = (output: ParserOutput) => output.omittedRoutes.map((entry) => entry.file);

const page = "export default function Page() { return <main />; }\n";

// ── Detection ──────────────────────────────────────────────────────────────

test("the first adapter in the fixed order wins, and the others are reported", () => {
  const next = analyse({ "package.json": manifest("react", "next", "@nestjs/core"), "a.ts": "" });
  assert.equal(next.adapter, "nextjs");
  assert.deepEqual(next.framework.evidence, [
    { file: "package.json", root: "", detail: 'package.json lists "next" as a dependency.' },
  ]);
  // The others matched the same package only, which needs no note.
  assert.deepEqual(next.framework.notes, []);

  // A framework in a package the chosen one does not cover is reported.
  const both = analyse({
    "web/package.json": manifest("next", "react"),
    "api/package.json": manifest("@nestjs/core"),
    "api/src/cats.controller.ts": "export class CatsController {}\n",
  });
  assert.equal(both.adapter, "nextjs");
  assert.equal(both.framework.notes.length, 1);
  assert.match(both.framework.notes[0].detail, /^NestJS was also found \(api\/package\.json\)/);
  assert.equal(roleOf(both, "api/src/cats.controller.ts"), "other");

  assert.equal(analyse({ "package.json": manifest("react", "@nestjs/core"), "a.ts": "" }).adapter, "nestjs");
  assert.equal(analyse({ "package.json": manifest("react"), "a.ts": "" }).adapter, "react");
});

test("a repository no adapter matches still analyses, with generic roles and no routes", () => {
  const output = analyse({
    "package.json": manifest("fastify"),
    "src/server.ts": 'import { helper } from "./helper";\nhelper();\n',
    "src/helper.ts": "export const helper = () => 1;\n",
    "src/helper.test.ts": 'import "./helper";\n',
    "vite.config.ts": "export default {};\n",
    "types/global.d.ts": "declare const x: number;\n",
    // Looks like a Next.js page and a Nest controller. Without the framework's
    // package there is no reason to read either as one.
    "app/page.tsx": page,
    "src/cats.controller.ts": "export class CatsController {}\n",
  });
  assert.equal(output.adapter, "fallback");
  assert.deepEqual(output.framework, { evidence: [], notes: [] });
  assert.deepEqual(output.routes, []);
  assert.deepEqual(output.omittedRoutes, []);
  assert.equal(output.edges.length, 2);
  assert.equal(roleOf(output, "src/helper.test.ts"), "test");
  assert.equal(roleOf(output, "vite.config.ts"), "config");
  assert.equal(roleOf(output, "types/global.d.ts"), "declaration");
  assert.equal(roleOf(output, "app/page.tsx"), "other");
  assert.equal(roleOf(output, "src/cats.controller.ts"), "other");
});

test("the same repository gives the same output twice", () => {
  const files = {
    "package.json": manifest("next", "react"),
    "app/page.tsx": page,
    "app/api/items/route.ts": "export async function GET() {}\nexport const POST = async () => {};\n",
  };
  assert.equal(JSON.stringify(analyse(files)), JSON.stringify(analyse(files)));
});

// ── Next.js ────────────────────────────────────────────────────────────────

test("Next.js App Router pages and endpoints come from the file conventions", () => {
  const output = analyse({
    "package.json": manifest("next", "react"),
    "app/layout.tsx": "export default function Layout({ children }) { return <html>{children}</html>; }\n",
    "app/page.tsx": page,
    "app/(marketing)/about/page.tsx": page,
    "app/blog/[slug]/page.tsx": page,
    "app/docs/[[...path]]/page.tsx": page,
    "app/api/items/route.ts":
      "export async function GET() {}\nconst create = async () => {};\nexport { create as POST };\nexport const runtime = 'edge';\n",
    "app/actions.ts": '"use server";\nexport async function save() {}\n',
    "components/button.tsx": "export function Button() { return <button />; }\n",
    "components/icons.tsx": "export const size = 16;\nexport const paths = { a: <path /> };\n",
    "lib/use-thing.ts": "export function useThing() { return 1; }\n",
    "lib/format.ts": "export const format = (value: number) => String(value);\n",
    "proxy.ts": "export function proxy() {}\n",
    "next.config.ts": "export default {};\n",
  });
  assert.equal(output.adapter, "nextjs");
  assert.deepEqual(routesOf(output), [
    "PAGE / <- app/page.tsx",
    "PAGE /about <- app/(marketing)/about/page.tsx",
    "GET /api/items <- app/api/items/route.ts",
    "POST /api/items <- app/api/items/route.ts",
    "PAGE /blog/[slug] <- app/blog/[slug]/page.tsx",
    "PAGE /docs/[[...path]] <- app/docs/[[...path]]/page.tsx",
  ]);
  assert.deepEqual(output.omittedRoutes, []);
  assert.equal(roleOf(output, "app/page.tsx"), "page-route");
  assert.equal(roleOf(output, "app/api/items/route.ts"), "api-endpoint");
  assert.equal(roleOf(output, "app/layout.tsx"), "layout");
  assert.equal(roleOf(output, "app/actions.ts"), "server-action");
  assert.equal(roleOf(output, "components/button.tsx"), "component");
  // JSX, but nothing exported that could be a component.
  assert.equal(roleOf(output, "components/icons.tsx"), "other");
  assert.equal(roleOf(output, "lib/use-thing.ts"), "hook");
  assert.equal(roleOf(output, "lib/format.ts"), "other");
  assert.equal(roleOf(output, "proxy.ts"), "middleware");
  assert.equal(roleOf(output, "next.config.ts"), "config");

  const get = output.routes.find((route) => route.method === "GET");
  assert.deepEqual(
    { kind: get?.kind, handler: get?.handler, line: get?.line, framework: get?.framework },
    { kind: "http", handler: "GET", line: 1, framework: "nextjs" },
  );
});

test("Next.js Pages Router pages and API handlers come from the file conventions", () => {
  const output = analyse({
    "package.json": manifest("next", "react"),
    "src/pages/_app.tsx": "export default function App({ Component }) { return <Component />; }\n",
    "src/pages/index.tsx": page,
    "src/pages/posts/[id].tsx": page,
    "src/pages/posts/index.tsx": page,
    "src/pages/api/users/[id].ts": "export default function handler(req, res) { res.end(); }\n",
    "src/pages/helpers.ts": "export const helper = 1;\n",
  });
  assert.deepEqual(routesOf(output), [
    "PAGE / <- src/pages/index.tsx",
    "ANY /api/users/[id] <- src/pages/api/users/[id].ts",
    "PAGE /posts <- src/pages/posts/index.tsx",
    "PAGE /posts/[id] <- src/pages/posts/[id].tsx",
  ]);
  assert.equal(roleOf(output, "src/pages/_app.tsx"), "layout");
  assert.equal(roleOf(output, "src/pages/api/users/[id].ts"), "api-endpoint");
  // In pages/ but with no default export: not a page Next.js could serve.
  assert.deepEqual(omittedIn(output), ["src/pages/helpers.ts"]);
  assert.equal(roleOf(output, "src/pages/helpers.ts"), "other");
});

test("Next.js conventions that are not supported produce no route", () => {
  const output = analyse({
    "package.json": manifest("next", "react"),
    "app/page.tsx": page,
    "app/@modal/login/page.tsx": page,
    "app/feed/(.)photo/[id]/page.tsx": page,
    "app/_internal/page.tsx": page,
    "app/empty/page.tsx": "export const metadata = {};\n",
    "app/api/none/route.ts": "export const dynamic = 'force-dynamic';\n",
    "app/api/star/route.ts": 'export * from "../../../lib/handlers";\n',
    "app/broken/page.tsx": "export default function Page() { return <main>; }\n",
    "lib/handlers.ts": "export async function GET() {}\n",
    // Looks like a route file, but is not in a routing directory.
    "lib/page.tsx": page,
    "lib/route.ts": "export async function GET() {}\n",
  });
  assert.deepEqual(routesOf(output), ["PAGE / <- app/page.tsx"]);
  assert.deepEqual(omittedIn(output), [
    "app/@modal/login/page.tsx",
    "app/api/none/route.ts",
    "app/api/star/route.ts",
    "app/broken/page.tsx",
    "app/empty/page.tsx",
    "app/feed/(.)photo/[id]/page.tsx",
  ]);
  // A private folder is not a route and is not reported as a missed one.
  assert.equal(roleOf(output, "app/_internal/page.tsx"), "component");
  assert.equal(roleOf(output, "lib/page.tsx"), "component");
  assert.equal(roleOf(output, "lib/route.ts"), "other");
  assert.equal(roleOf(output, "app/api/star/route.ts"), "other");
});

test("Next.js config that changes routing is noted, and pageExtensions stops extraction", () => {
  const output = analyse({
    "package.json": manifest("next", "react"),
    "next.config.js": "module.exports = { basePath: '/docs', pageExtensions: ['page.tsx'] };\n",
    "app/page.tsx": page,
    "pages/about.tsx": page,
  });
  assert.deepEqual(output.routes, []);
  assert.deepEqual(omittedIn(output), ["app/page.tsx", "pages/about.tsx"]);
  assert.deepEqual(
    output.framework.notes.map((note) => [note.file, note.line, note.detail.includes("basePath")]),
    [
      ["next.config.js", 1, true],
      ["next.config.js", 1, false],
    ],
  );
});

test("Next.js is read per package, only where a package.json names it", () => {
  const output = analyse({
    "package.json": JSON.stringify({ name: "workspace" }),
    "apps/web/package.json": manifest("next", "react"),
    "apps/web/app/dashboard/page.tsx": page,
    "packages/tools/package.json": manifest("typescript"),
    "packages/tools/app/page.tsx": page,
  });
  assert.equal(output.adapter, "nextjs");
  assert.deepEqual(routesOf(output), ["PAGE /dashboard <- apps/web/app/dashboard/page.tsx"]);
  assert.equal(roleOf(output, "packages/tools/app/page.tsx"), "other");
});

// ── NestJS ─────────────────────────────────────────────────────────────────

const catsController = `import { All, Controller, Delete, Get, Post, Version } from "@nestjs/common";
import { PATHS } from "./paths";

@Controller("cats")
export class CatsController {
  @Get()
  findAll() {}

  @Get(":id")
  findOne() {}

  @Post("/")
  create() {}

  @Delete("/:id/toys/:toyId?")
  removeToy() {}

  @Get(["a", "b"])
  aliases() {}

  @All("*")
  catchAll() {}

  @Get(PATHS.search)
  search() {}

  @Get(\`\${PATHS.search}/all\`)
  searchAll() {}

  @Version("2")
  @Get("versioned")
  versioned() {}

  @Get("computed")
  [PATHS.search]() {}

  notARoute() {}
}
`;

test("NestJS routes join the controller prefix and the method path exactly", () => {
  const output = analyse({
    "package.json": manifest("@nestjs/core", "@nestjs/common"),
    "src/cats/cats.controller.ts": catsController,
    "src/cats/paths.ts": 'export const PATHS = { search: "search" };\n',
  });
  assert.equal(output.adapter, "nestjs");
  assert.deepEqual(
    output.routes.map((route) => `${route.method} ${route.pattern} ${route.handler}:${route.line}`),
    [
      "GET /cats CatsController.findAll:6",
      "POST /cats CatsController.create:12",
      "ANY /cats/* CatsController.catchAll:21",
      "GET /cats/:id CatsController.findOne:9",
      "DELETE /cats/:id/toys/:toyId? CatsController.removeToy:15",
      "GET /cats/a CatsController.aliases:18",
      "GET /cats/b CatsController.aliases:18",
    ],
  );
  assert.deepEqual(
    output.omittedRoutes.map((entry) => `${entry.handler}:${entry.line}`),
    [
      "CatsController.search:24",
      "CatsController.searchAll:27",
      "CatsController.versioned:31",
      "null:34",
    ],
  );
  assert.equal(roleOf(output, "src/cats/cats.controller.ts"), "controller");
  assert.equal(output.files.find((file) => file.path === "src/cats/cats.controller.ts")?.role.line, 4);
});

test("NestJS controller prefixes that cannot be read stop every route under them", () => {
  const controller = (decorator: string) =>
    `import { Controller, Get } from "@nestjs/common";\nconst PREFIX = "x";\n@${decorator}\nexport class A {\n  @Get("one")\n  one() {}\n}\n`;
  const output = analyse({
    "package.json": manifest("@nestjs/core"),
    "src/none.controller.ts": controller("Controller()"),
    "src/object.controller.ts": controller('Controller({ path: "/v/", host: "a.example" })'),
    "src/constant.controller.ts": controller("Controller(PREFIX)"),
    "src/versioned.controller.ts": controller('Controller({ path: "v", version: "1" })'),
    "src/spread.controller.ts": controller("Controller({ ...PREFIX })"),
    // Decorators with the right names from the wrong package are not Nest's.
    "src/other.controller.ts":
      'import { Controller, Get } from "./decorators";\n@Controller("x")\nexport class B {\n  @Get("y")\n  y() {}\n}\n',
    "src/decorators.ts": "export const Controller = (p: string) => (t: unknown) => {};\nexport const Get = Controller;\n",
  });
  assert.deepEqual(routesOf(output), [
    "GET /one <- src/none.controller.ts",
    "GET /v/one <- src/object.controller.ts",
  ]);
  assert.deepEqual(omittedIn(output), [
    "src/constant.controller.ts",
    "src/spread.controller.ts",
    "src/versioned.controller.ts",
  ]);
  // Still a controller by its file name, and the reason says that is all.
  const other = output.files.find((file) => file.path === "src/other.controller.ts");
  assert.equal(other?.role.id, "controller");
  assert.match(other?.role.reason ?? "", /No decorator in the file decided this/);
});

test("NestJS roles come from decorators first and file names second", () => {
  const output = analyse({
    "package.json": manifest("@nestjs/core", "typeorm"),
    "src/app.ts":
      'import { Module } from "@nestjs/common";\n@Module({})\nexport class AppModule {}\n',
    "src/cat.ts": 'import { Entity } from "typeorm";\n@Entity()\nexport class Cat {}\n',
    "src/cats.service.ts":
      'import { Injectable } from "@nestjs/common";\n@Injectable()\nexport class CatsService {}\n',
    "src/auth.guard.ts":
      'import { Injectable } from "@nestjs/common";\n@Injectable()\nexport class AuthGuard {}\n',
    "src/cats.controller.spec.ts": 'import "./cats.service";\n',
    "src/main.ts": 'declare const app: any;\napp.setGlobalPrefix("api");\n',
    "src/broken.module.ts": "export class {\n",
  });
  assert.equal(roleOf(output, "src/app.ts"), "module");
  assert.equal(roleOf(output, "src/cat.ts"), "entity");
  assert.equal(roleOf(output, "src/cats.service.ts"), "service");
  // @Injectable alone does not say what a class is.
  assert.equal(roleOf(output, "src/auth.guard.ts"), "other");
  assert.equal(roleOf(output, "src/cats.controller.spec.ts"), "test");
  assert.equal(roleOf(output, "src/main.ts"), "other");
  // Could not be parsed, so only its name is evidence.
  assert.equal(roleOf(output, "src/broken.module.ts"), "module");
  assert.deepEqual(
    output.framework.notes.map((note) => [note.file, note.line]),
    [["src/main.ts", 2]],
  );
});

// ── React ──────────────────────────────────────────────────────────────────

test("React components and hooks are decided by JSX and exports, and there are no routes", () => {
  const output = analyse({
    "package.json": manifest("react", "react-router-dom"),
    "src/App.jsx": "export default function App() { return <div />; }\n",
    "src/list.js": "export const List = () => <ul />;\n",
    "src/memo.tsx": "import { memo } from 'react';\nconst Inner = () => <i />;\nexport const Memo = memo(Inner);\n",
    "src/reexport.tsx": "const Local = () => <b />;\nexport { Local as Renamed };\n",
    "src/useCount.ts": "export const useCount = () => 0;\n",
    "src/user.ts": "export const user = { name: 'a' };\nexport function username() { return user.name; }\n",
    "src/constants.tsx": "export const ICON = <svg />;\nexport const Limit = 3;\n",
    "src/routes.tsx": "const routes = [{ path: '/a', element: <div /> }];\nexport { routes };\n",
    "src/App.test.jsx": "import App from './App';\nconst el = <App />;\n",
  });
  assert.equal(output.adapter, "react");
  assert.deepEqual(output.routes, []);
  assert.equal(roleOf(output, "src/App.jsx"), "component");
  assert.equal(roleOf(output, "src/list.js"), "component");
  assert.equal(roleOf(output, "src/memo.tsx"), "component");
  assert.equal(roleOf(output, "src/reexport.tsx"), "component");
  assert.equal(roleOf(output, "src/useCount.ts"), "hook");
  // "username" and "user" start with "use" but are not hooks.
  assert.equal(roleOf(output, "src/user.ts"), "other");
  assert.equal(roleOf(output, "src/constants.tsx"), "other");
  assert.equal(roleOf(output, "src/routes.tsx"), "other");
  assert.equal(roleOf(output, "src/App.test.jsx"), "test");
  assert.match(output.framework.notes[0].detail, /extracts no routes/);
});

// ── CommonJS ───────────────────────────────────────────────────────────────

const edgesOf = (output: ParserOutput) =>
  output.edges.map((edge) => `${edge.source} -> ${edge.target} [${edge.kinds.join(",")}]`);

test("require() resolves like an import: extensions, index files and direction", () => {
  const output = analyse({
    "package.json": manifest(),
    "index.js":
      'const a = require("./lib/a");\nconst b = require("./lib/b.js");\nconst dir = require("./lib/dir");\nconst fs = require("fs");\n',
    "lib/a.js": "module.exports = 1;\n",
    "lib/b.js": "exports.b = 2;\n",
    "lib/dir/index.js": 'module.exports = require("../a");\n',
  });
  // The file that contains the require() is the source, as with an import.
  assert.deepEqual(edgesOf(output), [
    "index.js -> lib/a.js [require]",
    "index.js -> lib/b.js [require]",
    "index.js -> lib/dir/index.js [require]",
    "lib/dir/index.js -> lib/a.js [require]",
  ]);
  assert.deepEqual(output.coverage.references, {
    encountered: 5,
    internal: 4,
    external: 1,
    excluded: 0,
    unresolved: 0,
  });
});

test("the same target through import and through require() resolves identically", () => {
  const files = (statement: string) => ({
    "package.json": manifest(),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } } }),
    "main.ts": statement,
    "lib/a.ts": "export const a = 1;\n",
    "lib/dir/index.ts": "export const d = 1;\n",
  });
  const imported = analyse(
    files('import "./lib/a";\nimport "./lib/dir";\nimport "@lib/a";\nimport "./missing";\n'),
  );
  const required = analyse(
    files('require("./lib/a");\nrequire("./lib/dir");\nrequire("@lib/a");\nrequire("./missing");\n'),
  );
  const shape = (output: ParserOutput) => ({
    edges: output.edges.map((edge) => [
      edge.source,
      edge.target,
      edge.evidence.map((entry) => [entry.specifier, entry.line, entry.via]),
    ]),
    unresolved: output.unlinkedReferences.map((entry) =>
      entry.status === "unresolved" ? [entry.specifier, entry.reason] : entry.status,
    ),
  });
  assert.deepEqual(shape(required), shape(imported));
  assert.equal(required.edges.length, 2);
});

test("a file mixing import and require() gets one edge per target, with both as evidence", () => {
  const output = analyse({
    "package.json": manifest(),
    "main.js":
      'import { a } from "./a";\nconst again = require("./a");\nconst b = require("./b");\nexport { b } from "./b";\n',
    "a.js": "export const a = 1;\n",
    "b.js": "export const b = 1;\n",
  });
  assert.deepEqual(edgesOf(output), [
    "main.js -> a.js [import,require]",
    "main.js -> b.js [re-export,require]",
  ]);
  assert.deepEqual(
    output.edges[0].evidence.map((entry) => [entry.kind, entry.line]),
    [
      ["import", 1],
      ["require", 2],
    ],
  );
  assert.deepEqual(output.metrics.find((metric) => metric.file === "main.js"), {
    file: "main.js",
    fanIn: 0,
    fanOut: 2,
  });
});

test("require() that cannot be resolved is counted, and never becomes an edge", () => {
  const output = analyse({
    "package.json": manifest(),
    "main.js":
      'const name = "./a";\nrequire(name);\nrequire("./" + name);\nrequire(`./${name}`);\nrequire("./gone");\nrequire("./a");\nrequire("./a", "extra");\nrequire();\n',
    "a.js": "module.exports = 1;\n",
  });
  assert.deepEqual(edgesOf(output), ["main.js -> a.js [require]"]);
  assert.deepEqual(
    output.unlinkedReferences.map((entry) =>
      entry.status === "unresolved" ? `${entry.line} ${entry.reason}` : entry.status,
    ),
    [
      "2 non-literal-specifier",
      "3 non-literal-specifier",
      "4 non-literal-specifier",
      "5 file-not-found",
    ],
  );
  // One resolved out of five that point, or may point, inside the repository.
  const { references } = output.coverage;
  assert.deepEqual([references.internal, references.unresolved], [1, 4]);
});

// ── Express ────────────────────────────────────────────────────────────────

test("Express roles come from folder names, singular or plural, and there are no routes", () => {
  const router = 'const express = require("express");\nconst router = express.Router();\nrouter.get("/users", () => {});\nmodule.exports = router;\n';
  const output = analyse({
    "package.json": manifest("express"),
    "src/app.js": 'const routes = require("./routes/v1");\nmodule.exports = routes;\n',
    "src/routes/v1/index.js": router,
    "src/controllers/user.controller.js": "module.exports = {};\n",
    "src/middlewares/auth.js": "module.exports = () => {};\n",
    "src/services/user.service.js": "module.exports = {};\n",
    "src/models/user.model.js": "module.exports = {};\n",
    "src/routes/middleware/validate.js": "module.exports = () => {};\n",
    "src/routes/__tests__/users.js": "",
    "src/utils/pick.js": "module.exports = () => {};\n",
    "legacy/route/a.js": router,
    "legacy/router/b.js": router,
    "legacy/controller/a.js": "",
    "legacy/middleware/a.js": "",
    "legacy/service/a.js": "",
    "legacy/model/a.js": "",
    // Named like a controller, but not in a folder that says so.
    "legacy/user.controller.js": "",
    "legacy/Controllers/a.js": "",
  });
  assert.equal(output.adapter, "express");
  assert.equal(roleOf(output, "src/routes/v1/index.js"), "express-route-module");
  assert.equal(roleOf(output, "src/controllers/user.controller.js"), "express-controller");
  assert.equal(roleOf(output, "src/middlewares/auth.js"), "express-middleware");
  assert.equal(roleOf(output, "src/services/user.service.js"), "express-service");
  assert.equal(roleOf(output, "src/models/user.model.js"), "express-model");
  // The deeper folder decides.
  assert.equal(roleOf(output, "src/routes/middleware/validate.js"), "express-middleware");
  assert.equal(roleOf(output, "src/routes/__tests__/users.js"), "test");
  assert.equal(roleOf(output, "legacy/route/a.js"), "express-route-module");
  assert.equal(roleOf(output, "legacy/router/b.js"), "express-route-module");
  assert.equal(roleOf(output, "legacy/controller/a.js"), "express-controller");
  assert.equal(roleOf(output, "legacy/middleware/a.js"), "express-middleware");
  assert.equal(roleOf(output, "legacy/service/a.js"), "express-service");
  assert.equal(roleOf(output, "legacy/model/a.js"), "express-model");
  for (const file of ["src/app.js", "src/utils/pick.js", "legacy/user.controller.js", "legacy/Controllers/a.js"]) {
    assert.equal(roleOf(output, file), "other", file);
  }
  // router.get("/users") is in the source, and still no route is claimed.
  assert.deepEqual(output.routes, []);
  assert.deepEqual(output.omittedRoutes, []);
  assert.match(output.framework.notes[0].detail, /does not mean the application has no routes/);
});

test("Express comes after Next.js and NestJS, and before React", () => {
  const adapter = (...dependencies: string[]) =>
    analyse({ "package.json": manifest(...dependencies), "a.js": "" }).adapter;
  assert.equal(adapter("express", "next", "react"), "nextjs");
  assert.equal(adapter("express", "@nestjs/core"), "nestjs");
  assert.equal(adapter("express", "react"), "express");
  assert.equal(adapter("express"), "express");
});

test("CommonJS exports are read for the roles that depend on exported names", () => {
  const output = analyse({
    "package.json": manifest("react"),
    "whole.jsx": "function Card() { return <div />; }\nmodule.exports = Card;\n",
    "named.jsx": "exports.Card = () => <div />;\n",
    "object.jsx": "const Card = () => <div />;\nmodule.exports = { Card };\n",
    "hooks.js": "module.exports.useThing = function () {};\n",
    "data.jsx": "module.exports = { icon: <svg /> };\n",
    "inside.jsx": "function setup() { module.exports = () => <div />; }\n",
  });
  assert.equal(roleOf(output, "whole.jsx"), "component");
  assert.equal(roleOf(output, "named.jsx"), "component");
  assert.equal(roleOf(output, "object.jsx"), "component");
  assert.equal(roleOf(output, "hooks.js"), "hook");
  assert.equal(roleOf(output, "data.jsx"), "other");
  // Assigned inside a function: not something the file is known to export.
  assert.equal(roleOf(output, "inside.jsx"), "other");
});
