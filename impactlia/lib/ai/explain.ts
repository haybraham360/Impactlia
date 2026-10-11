import "server-only";
import { createHash } from "node:crypto";
import { runAiTask } from "@/lib/ai/client";
import { PROMPT_VERSIONS, type AiTask } from "@/lib/ai/config";
import {
  buildFileEvidence,
  buildFolderEvidence,
  fileIdentity,
  folderIdentity,
  roleIdentity,
  staleReasons,
  type InputIdentity,
} from "@/lib/ai/evidence";
import { filePrompt, folderPrompt, rolePrompt, type Prompt } from "@/lib/ai/prompts";
import { readSuggestedRole } from "@/lib/ai/roles";
import {
  listResults,
  readResult,
  recordRun,
  writeResult,
  type StoredResult,
} from "@/lib/ai/store";
import { AiInputError, type TracedResult } from "@/lib/ai/traced";
import {
  subjectKey,
  type ExplainOutcome,
  type ExplanationEntry,
  type Revision,
  type RoleSuggestion,
  type StoredAi,
  type SubjectKind,
} from "@/lib/ai/types";
import { fetchFileAtCommit, findHeadCommit } from "@/lib/github/public-repository";
import { buildGraphModel, type GraphFolder } from "@/lib/graph/model";
import { IngestionError } from "@/lib/ingestion/errors";
import { getStoredAnalysis } from "@/lib/ingestion/runs";
import { getWorkspace } from "@/lib/workspace";
import type { FileNode, ParserOutput } from "@/parser/contract";
import { readParserOutput } from "@/parser/validate";

// Explaining a file or a folder: evidence from the stored analysis, a key from
// the evidence, then one traced, cached request. Nothing here reads a
// repository the signed-in member's organization does not own, because the
// analysis itself is read through that member's token.

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_EXPLANATION_CHARACTERS = 20_000;

type Repository = { id: string; owner: string; name: string; defaultBranch: string };

// The file's source, read from GitHub at the analysed commit and accepted only
// if it is byte-for-byte what the parser hashed. Source is never stored, so
// this is the one moment it is in hand.
async function fetchVerifiedSource(
  repository: Repository,
  sourceSha: string | null,
  file: FileNode,
): Promise<string> {
  if (!sourceSha) {
    throw new AiInputError(
      "The commit this analysis came from is not known, so the file's source cannot be fetched and checked. Re-analyze the repository.",
    );
  }
  let bytes: Buffer;
  try {
    bytes = await fetchFileAtCommit(repository, sourceSha, file.path, MAX_SOURCE_BYTES);
  } catch (error) {
    if (error instanceof IngestionError) throw new AiInputError(error.message);
    throw error;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== file.contentHash) {
    throw new AiInputError(
      "GitHub returned different content from what was analysed, so nothing was sent to the model.",
    );
  }
  return bytes.toString("utf8");
}

// Runs once however many requests ask, and not at all if none does.
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load());
}

type Request<Prepared> = {
  task: AiTask;
  subject: string;
  identity: InputIdentity;
  prepare: () => Promise<Prepared>;
  prompt: (prepared: Prepared) => Prompt;
  // The validated body and what was left out of the input, or null to reject.
  accept: (text: string, prepared: Prepared) => { body: string; omitted: string[] } | null;
};

function run<Prepared>(
  organizationId: string,
  repositoryId: string,
  request: Request<Prepared>,
): Promise<TracedResult<StoredResult>> {
  const { task, subject, identity } = request;
  return runAiTask<Prepared, StoredResult>(
    {
      task,
      subject,
      promptVersion: PROMPT_VERSIONS[task],
      inputHash: identity.inputHash,
      readCache: () => readResult(repositoryId, task, identity.inputHash),
      prepare: request.prepare,
      prompt: request.prompt,
      accept: (text, prepared) => {
        const accepted = request.accept(text, prepared);
        return (
          accepted && { ...identity, ...accepted, task, subject, createdAt: new Date().toISOString() }
        );
      },
      writeCache: (result) => writeResult(organizationId, repositoryId, result),
    },
    (trace) => recordRun(organizationId, repositoryId, trace),
  );
}

const readExplanation = (text: string) => {
  const body = text.trim();
  return body !== "" && body.length <= MAX_EXPLANATION_CHARACTERS ? body : null;
};

function toEntry(
  result: StoredResult,
  origin: ExplanationEntry["origin"],
  stale: string[],
): ExplanationEntry {
  return {
    body: result.body,
    omitted: result.omitted,
    model: result.model,
    sourceSha: result.sourceSha,
    createdAt: result.createdAt,
    origin,
    stale,
  };
}

function notesFor(result: TracedResult<StoredResult>, what: string): string[] {
  const notes: string[] = [];
  if (!result.traceRecorded) {
    notes.push(`The ${what} request ran, but it could not be recorded in the AI runs trace.`);
  }
  if (result.ok && result.cacheStatus === "read-failed") {
    notes.push(`The cache could not be read, so the ${what} was written afresh.`);
  }
  if (result.ok && result.cacheStatus === "write-failed") {
    notes.push(`The ${what} could not be saved, so it will be written again next time.`);
  }
  return notes;
}

type Analysis = {
  repository: Repository;
  output: ParserOutput;
  folders: GraphFolder[];
  sourceSha: string | null;
};

async function loadAnalysis(repositoryId: string): Promise<Analysis | null> {
  const stored = await getStoredAnalysis(repositoryId);
  if (!stored?.graph) return null;
  const output = readParserOutput(stored.graph.parserOutput);
  return {
    repository: stored.repository,
    output,
    folders: buildGraphModel(output).folders,
    sourceSha: stored.graph.sourceSha,
  };
}

const unavailable = (message: string): ExplainOutcome => ({
  explanation: { ok: false, message },
  role: null,
  notes: [],
});

export async function explainSubject(
  repositoryId: string,
  kind: SubjectKind,
  id: string,
): Promise<ExplainOutcome> {
  const { organizationId } = await getWorkspace();
  const analysis = await loadAnalysis(repositoryId);
  if (!analysis) return unavailable("This repository has no stored analysis to explain from.");
  const { repository, output, folders, sourceSha } = analysis;

  if (kind === "folder") {
    const folder = folders.find((entry) => entry.id === id);
    const evidence = buildFolderEvidence(output, folders, id, sourceSha);
    if (!folder || !evidence) return unavailable("That folder is not in the current analysis.");
    const result = await run(organizationId, repositoryId, {
      task: "folder-explanation",
      subject: id,
      identity: folderIdentity(repositoryId, evidence, output, folder),
      prepare: async () => folderPrompt(evidence),
      prompt: (prepared) => prepared.prompt,
      accept: (text, prepared) => {
        const body = readExplanation(text);
        return body === null ? null : { body, omitted: prepared.omitted };
      },
    });
    return {
      explanation: result.ok
        ? { ok: true, entry: toEntry(result.value, result.cacheStatus === "hit" ? "cache" : "model", []) }
        : { ok: false, message: result.message },
      role: null,
      notes: notesFor(result, "explanation"),
    };
  }

  const file = output.files.find((entry) => entry.id === id);
  const evidence = buildFileEvidence(output, id, sourceSha);
  if (!file || !evidence) return unavailable("That file is not in the current analysis.");
  const source = once(() => fetchVerifiedSource(repository, sourceSha, file));

  const explaining = run(organizationId, repositoryId, {
    task: "file-explanation",
    subject: id,
    identity: fileIdentity(repositoryId, evidence),
    prepare: async () => filePrompt(evidence, await source()),
    prompt: (prepared) => prepared.prompt,
    accept: (text, prepared) => {
      const body = readExplanation(text);
      return body === null ? null : { body, omitted: prepared.omitted };
    },
  });
  // Only a file no deterministic rule placed is offered to the model, as its
  // own request with its own trace. Whatever comes back, the file's role in
  // the analysis stays exactly what the adapter gave it.
  const classifying =
    file.role.id === "other"
      ? run(organizationId, repositoryId, {
          task: "role-classification",
          subject: id,
          identity: roleIdentity(repositoryId, file, sourceSha),
          prepare: source,
          prompt: (text) => rolePrompt(file.path, text),
          accept: (text) => {
            const role = readSuggestedRole(text);
            return role === null ? null : { body: role, omitted: [] };
          },
        })
      : null;
  const [explained, classified] = await Promise.all([explaining, classifying]);

  const role = classified?.ok ? readSuggestedRole(classified.value.body) : null;
  return {
    explanation: explained.ok
      ? { ok: true, entry: toEntry(explained.value, explained.cacheStatus === "hit" ? "cache" : "model", []) }
      : { ok: false, message: explained.message },
    role: role && classified?.ok ? { role, model: classified.value.model } : null,
    notes: [
      ...notesFor(explained, "explanation"),
      ...(classified ? notesFor(classified, "role suggestion") : []),
    ],
  };
}

// What is already stored for a repository, compared with the analysis being
// shown. An explanation whose inputs no longer match is still returned, with
// the reasons, so the pane can show it as stale instead of as current. A role
// suggestion is only returned while the file it was made from is unchanged.
export async function loadStoredAi(
  repositoryId: string,
  output: ParserOutput,
  folders: GraphFolder[],
  sourceSha: string | null,
): Promise<StoredAi> {
  let results: StoredResult[];
  try {
    results = await listResults(repositoryId);
  } catch (error) {
    console.error("Stored AI results could not be read:", error);
    return {
      explanations: {},
      roles: {},
      problem: "Explanations written earlier could not be loaded. New ones can still be requested.",
    };
  }

  const fileById = new Map(output.files.map((file) => [file.id, file]));
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const current = new Map<string, InputIdentity | null>();
  const identityOf = (task: AiTask, subject: string): InputIdentity | null => {
    const key = `${task}:${subject}`;
    let identity = current.get(key);
    if (identity === undefined) {
      const file = fileById.get(subject);
      const folder = folderById.get(subject);
      if (task === "role-classification") {
        identity = file ? roleIdentity(repositoryId, file, sourceSha) : null;
      } else if (task === "file-explanation") {
        const evidence = buildFileEvidence(output, subject, sourceSha);
        identity = evidence && fileIdentity(repositoryId, evidence);
      } else {
        const evidence = buildFolderEvidence(output, folders, subject, sourceSha);
        identity = evidence && folder ? folderIdentity(repositoryId, evidence, output, folder) : null;
      }
      current.set(key, identity);
    }
    return identity;
  };

  const explanations: Record<string, ExplanationEntry> = {};
  const roles: Record<string, RoleSuggestion> = {};
  // Newest first: the first result met for a subject is kept, unless a later
  // one is the exact answer to the current inputs.
  for (const result of results) {
    const identity = identityOf(result.task, result.subject);
    if (!identity) continue;
    const exact = result.inputHash === identity.inputHash;
    if (result.task === "role-classification") {
      const role = readSuggestedRole(result.body);
      const file = fileById.get(result.subject);
      if (exact && role && file?.role.id === "other") {
        roles[result.subject] = { role, model: result.model };
      }
      continue;
    }
    const key = subjectKey(result.task === "file-explanation" ? "file" : "folder", result.subject);
    if (exact || !(key in explanations)) {
      explanations[key] = toEntry(result, "stored", staleReasons(result, identity));
    }
  }
  return { explanations, roles, problem: null };
}

// Asks GitHub where the default branch is now. Never throws: not being able to
// ask is an answer too, and it is "unknown".
export async function checkRevision(
  repository: Repository,
  sourceSha: string | null,
): Promise<Revision> {
  if (!sourceSha) {
    return { status: "unknown", reason: "The commit this analysis came from was not recorded." };
  }
  try {
    const headSha = await findHeadCommit(repository);
    return headSha === sourceSha ? { status: "current" } : { status: "moved", headSha };
  } catch (error) {
    return {
      status: "unknown",
      reason:
        error instanceof IngestionError
          ? error.message
          : "GitHub could not be asked for the repository's current commit.",
    };
  }
}
