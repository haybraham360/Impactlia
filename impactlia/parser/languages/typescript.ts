import path from "node:path";
import ts from "typescript";
import type { ResolvedReference } from "../graph";
import { extractReferences } from "../references";
import { createResolver } from "../resolve";
import {
  PARSE_ERROR_LIMIT,
  restated,
  storedStatements,
  type FileReading,
  type LanguageContext,
  type LanguageReading,
} from "./adapter";

// TypeScript and JavaScript, read with the TypeScript compiler's parser and
// resolved with its module resolution under the repository's own tsconfig
// and jsconfig files.
//
// It also hands back the syntax trees of the files that parsed, because the
// framework adapters (Next.js, NestJS, Express, React) read them. Those
// frameworks are all JavaScript ones, so only this adapter has to.

export type TypeScriptReading = LanguageReading & { syntax: Map<string, ts.SourceFile> };

// TS8xxx diagnostics say "this syntax is only allowed in TypeScript files".
// The file still parsed, so they do not count as parse failures.
const isTypeScriptOnlySyntax = (code: number) => code >= 8000 && code < 9000;

export function readTypeScript({ root, walk, files, texts, stored }: LanguageContext): TypeScriptReading {
  const absoluteTexts = new Map(
    files.map((file) => [path.join(root, file), texts.get(file) ?? ""] as const),
  );

  // One program over every file gives the syntax trees and, through the
  // public API, their syntax errors. `noResolve` and `noLib` keep the
  // compiler from following imports itself; resolution is done below, one
  // reference at a time, so that every outcome is recorded.
  const options: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => root;
  host.getSourceFile = (fileName, languageVersionOrOptions) => {
    const text = absoluteTexts.get(fileName);
    return text === undefined
      ? undefined
      : ts.createSourceFile(fileName, text, languageVersionOrOptions);
  };
  const program = ts.createProgram({ rootNames: [...absoluteTexts.keys()], options, host });

  const resolver = createResolver(root, walk);
  const readings = new Map<string, FileReading>();
  // Only files that parsed cleanly: the tree of one with syntax errors is a
  // best-effort recovery, and no role or route is read from it.
  const syntax = new Map<string, ts.SourceFile>();
  for (const file of files) {
    const sourceFile = program.getSourceFile(path.join(root, file));
    if (!sourceFile) throw new Error(`${file} was not loaded by the TypeScript parser.`);
    const errors = program
      .getSyntacticDiagnostics(sourceFile)
      .filter((diagnostic) => !isTypeScriptOnlySyntax(diagnostic.code));
    if (errors.length > 0) {
      readings.set(file, {
        parseStatus: "failed",
        parseErrors: errors.slice(0, PARSE_ERROR_LIMIT).map((diagnostic) => ({
          line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        })),
        // The tree of a file with syntax errors is a best-effort recovery.
        // References read from it could be artefacts, so none are taken.
        references: [],
      });
      continue;
    }
    syntax.set(file, sourceFile);
    const references: ResolvedReference[] = extractReferences(sourceFile).map((site) => ({
      source: file,
      site,
      resolution: resolver.resolve(file, site),
    }));
    readings.set(file, { parseStatus: "parsed", parseErrors: [], references });
  }
  // A stored file's references, resolved again: a file added or removed
  // elsewhere can change what a specifier names. One named by an expression
  // stays unresolved, as it was.
  for (const [file, references] of stored) {
    const resolved = storedStatements(references).flatMap((statement) => {
      const { site } = statement[0];
      return site.specifier === null ? statement : restated(statement, [resolver.resolve(file, site)]);
    });
    readings.set(file, { parseStatus: "parsed", parseErrors: [], references: resolved });
  }
  return { files: readings, resolutionConfigs: resolver.configs(), syntax };
}
