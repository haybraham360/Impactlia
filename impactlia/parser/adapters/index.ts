import type { FrameworkAdapter } from "../adapter";
import { expressAdapter } from "./express";
import { nestjsAdapter } from "./nestjs";
import { nextjsAdapter } from "./nextjs";
import { reactAdapter } from "./react";

// The supported frameworks, in the order they are tried. The first one whose
// package appears in any package.json of the repository reads the whole
// repository; when none does, files get generic roles and there are no routes.
//
//   1. Next.js   "next"
//   2. NestJS    "@nestjs/core"
//   3. Express   "express"
//   4. React     "react"
//
// The order runs from most to least specific. A Next.js application also
// depends on React, and one with a custom server on Express too; NestJS runs
// on Express and sometimes lists it. So each of those comes before what it is
// built on. Express comes before React because React is the adapter for
// repositories nothing more specific claims. A repository holding two
// frameworks in different packages is read as the earlier one, and says so.
export const frameworkAdapters: FrameworkAdapter[] = [
  nextjsAdapter,
  nestjsAdapter,
  expressAdapter,
  reactAdapter,
];
