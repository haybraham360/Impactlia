// The file roles each supported framework has, and the order they are shown
// in. Plain data with no imports, so the browser can name a role without
// loading the parser or anything that touches the filesystem.
//
// Order within a framework is fixed: what can be reached by a request first,
// then the application's layers, then supporting files. "other" is always
// last and is where anything a rule could not place stays.
//
// Every role's `rule` is the whole of what decides it. Adapters implement the
// rule; this file is where it is written down and where the interface reads
// it from.

export type RoleDefinition = { label: string; rule: string };

export const ROLES = {
  "page-route": {
    label: "Page routes",
    rule: "A page file in the App Router or Pages Router directory with a default export, whose address the file path fully determines.",
  },
  "api-endpoint": {
    label: "API endpoints",
    rule: "A route file in the App Router directory that exports an HTTP method, or a file under pages/api with a default export.",
  },
  "server-action": {
    label: "Server actions",
    rule: 'A file that opens with the "use server" directive.',
  },
  layout: {
    label: "Layouts and route states",
    rule: "layout, template, loading, error, global-error, not-found, forbidden, unauthorized and default files in the App Router directory; _app, _document and _error in pages/.",
  },
  middleware: {
    label: "Middleware and instrumentation",
    rule: "middleware, proxy, instrumentation or instrumentation-client at the package root or in src/.",
  },
  controller: {
    label: "Controllers",
    rule: "Declares a class decorated with @Controller() from @nestjs/common, or is named *.controller.ts.",
  },
  service: {
    label: "Services",
    rule: "Named *.service.ts, the Nest CLI's name for a service.",
  },
  module: {
    label: "Modules",
    rule: "Declares a class decorated with @Module() from @nestjs/common, or is named *.module.ts.",
  },
  entity: {
    label: "Entities",
    rule: "Declares a class decorated with @Entity() from typeorm or @mikro-orm/core, or is named *.entity.ts.",
  },
  "express-route-module": {
    label: "Route modules",
    rule: "Inside a folder named route, routes, router or routers. The routes themselves are not read.",
  },
  "express-controller": {
    label: "Controllers",
    rule: "Inside a folder named controller or controllers.",
  },
  "express-middleware": {
    label: "Middleware",
    rule: "Inside a folder named middleware or middlewares.",
  },
  "express-service": {
    label: "Services",
    rule: "Inside a folder named service or services.",
  },
  "express-model": {
    label: "Models",
    rule: "Inside a folder named model or models.",
  },
  component: {
    label: "Components",
    rule: "Contains JSX and exports a capitalised function or class, or has a default export.",
  },
  hook: {
    label: "Hooks",
    rule: "Exports a function named use followed by a capital letter, and is not a component.",
  },
  test: {
    label: "Tests",
    rule: "Named *.test.* or *.spec.*, or inside a __tests__ directory.",
  },
  config: {
    label: "Configuration",
    rule: "Named *.config.*, the usual name for a tool's configuration.",
  },
  declaration: {
    label: "Type declarations",
    rule: "A type declaration file (*.d.ts).",
  },
  other: {
    label: "Other source files",
    rule: "Matched by no rule above. That says nothing about whether the file is used.",
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleId = keyof typeof ROLES;
export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

// The roles every repository has, with or without a framework.
const SUPPORTING = ["test", "config", "declaration", "other"] as const satisfies RoleId[];

export const FALLBACK = "fallback";

// Keyed by adapter name, which is what the parser output stores.
export const FRAMEWORKS = {
  nextjs: {
    label: "Next.js",
    roles: [
      "page-route",
      "api-endpoint",
      "server-action",
      "layout",
      "middleware",
      "component",
      "hook",
      ...SUPPORTING,
    ],
  },
  nestjs: {
    label: "NestJS",
    roles: ["controller", "service", "module", "entity", ...SUPPORTING],
  },
  express: {
    label: "Express",
    roles: [
      "express-route-module",
      "express-controller",
      "express-middleware",
      "express-service",
      "express-model",
      ...SUPPORTING,
    ],
  },
  react: {
    label: "React",
    roles: ["component", "hook", ...SUPPORTING],
  },
  // No framework matched.
  [FALLBACK]: { label: null, roles: SUPPORTING },
} as const satisfies Record<string, { label: string | null; roles: readonly RoleId[] }>;

export type FrameworkName = keyof typeof FRAMEWORKS;
export const FRAMEWORK_NAMES = Object.keys(FRAMEWORKS) as FrameworkName[];
