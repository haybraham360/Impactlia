"use server";

import { explainSubject } from "@/lib/ai/explain";
import type { ExplainOutcome, SubjectKind } from "@/lib/ai/types";

// Called from the detail pane. The arguments come from a browser, so they are
// checked as untrusted; which repository the caller may read is decided by the
// database when the analysis is loaded.
export async function requestExplanation(
  repositoryId: unknown,
  kind: unknown,
  id: unknown,
): Promise<ExplainOutcome> {
  if (
    typeof repositoryId !== "string" ||
    typeof id !== "string" ||
    id.length > 1000 ||
    (kind !== "file" && kind !== "folder")
  ) {
    return {
      explanation: { ok: false, message: "That is not something that can be explained." },
      role: null,
      notes: [],
    };
  }
  const subject: SubjectKind = kind;
  try {
    return await explainSubject(repositoryId, subject, id);
  } catch (error) {
    // The real error stays on the server.
    console.error("An explanation request failed unexpectedly:", error);
    return {
      explanation: {
        ok: false,
        message:
          "Something went wrong while preparing the explanation. The details were logged on the server; you can try again.",
      },
      role: null,
      notes: [],
    };
  }
}
