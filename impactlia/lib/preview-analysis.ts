import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ParserOutput } from "@/parser/contract";
import { readParserOutput } from "@/parser/validate";

// Where the development preview looks for parser output, relative to the
// directory the app runs from. Written by `pnpm parse <repo> --out <this>`.
export const PREVIEW_OUTPUT_FILE = "parser-output.preview.json";

export type PreviewAnalysis =
  | { status: "ready"; output: ParserOutput }
  | { status: "missing" }
  | { status: "invalid"; message: string };

export function readPreviewAnalysis(): PreviewAnalysis {
  const file = path.join(process.cwd(), PREVIEW_OUTPUT_FILE);
  if (!fs.existsSync(file)) return { status: "missing" };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return { status: "ready", output: readParserOutput(parsed) };
  } catch (error) {
    // A file that is there but unusable is shown as such, never as an empty
    // repository.
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
