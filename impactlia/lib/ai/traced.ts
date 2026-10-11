import type { AiTask } from "./config";

// The one shape every AI request takes. A request looks in the cache, and only
// on a miss assembles its input and calls a model; all of it happens inside
// one traced operation, and exactly one trace record is written at the end
// whichever way it went. A cache hit is therefore a recorded run with no model
// call in it.
//
// Nothing here knows about a provider, a database or a tracing service: they
// arrive as functions, which is what lets the checks run this without any of
// them.

export type CacheStatus = "hit" | "miss" | "read-failed" | "write-failed";
export type Outcome = "succeeded" | "input-failed" | "model-failed" | "rejected";

// null means the provider did not report usage. It is never guessed as zero.
export type TokenUsage = { inputTokens: number; outputTokens: number } | null;

export type TraceRecord = {
  task: AiTask;
  subject: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  cacheStatus: CacheStatus;
  outcome: Outcome;
  modelCalled: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  errorSummary: string | null;
  externalTrace: boolean;
  startedAt: string;
  finishedAt: string;
};

// A failure whose message was written for the person who asked. Any other
// error is described by its type alone, so a provider's message, a key or a
// piece of a repository never reaches a trace or the screen.
export class AiInputError extends Error {}

// A step inside the trace. What it returns is all the external tracing service
// is shown of that step, so it must never carry source code or a secret.
type SpanFacts = Record<string, string | number | boolean | null>;
export type Span = (
  name: string,
  type: "chain" | "llm" | "retriever",
  step: () => Promise<SpanFacts>,
) => Promise<void>;

export type TracedTask<Prepared, Value> = {
  task: AiTask;
  subject: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  readCache: () => Promise<Value | null>;
  // Assembles what the model needs. Runs only on a cache miss.
  prepare: () => Promise<Prepared>;
  callModel: (prepared: Prepared) => Promise<{ text: string; usage: TokenUsage }>;
  // Validates the model's answer. null rejects it.
  accept: (text: string, prepared: Prepared) => Value | null;
  writeCache: (value: Value) => Promise<void>;
};

export type TracedEnvironment = {
  now: () => Date;
  span: Span;
  externalTrace: boolean;
  record: (trace: TraceRecord) => Promise<void>;
};

export type TracedResult<Value> = (
  | { ok: true; value: Value; cacheStatus: CacheStatus }
  | { ok: false; outcome: Exclude<Outcome, "succeeded">; message: string }
) & {
  // False when the run happened but its trace record could not be written.
  traceRecorded: boolean;
};

type Failure = { outcome: Exclude<Outcome, "succeeded">; summary: string; message: string };

function describe(error: unknown): string {
  if (error instanceof AiInputError) return error.message;
  const name = error instanceof Error ? error.name : "Error";
  const status =
    typeof error === "object" && error !== null && "status" in error ? error.status : null;
  // A provider's error code is a fixed identifier such as "rate_limit_exceeded",
  // and is kept only when it looks like one. Its message never is.
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  return [
    name,
    ...(typeof status === "number" ? [`status ${status}`] : []),
    ...(typeof code === "string" && /^[a-z0-9_]{1,60}$/.test(code) ? [code] : []),
  ].join(", ");
}

export async function runTraced<Prepared, Value>(
  task: TracedTask<Prepared, Value>,
  environment: TracedEnvironment,
): Promise<TracedResult<Value>> {
  const startedAt = environment.now();
  // One object, because the steps below run inside callbacks and each of them
  // moves the run on.
  const run: {
    cacheStatus: CacheStatus;
    modelCalled: boolean;
    usage: TokenUsage;
    value: Value | null;
    failure: Failure | null;
  } = { cacheStatus: "miss", modelCalled: false, usage: null, value: null, failure: null };

  await environment.span(task.task, "chain", async () => {
    await environment.span("cache-read", "retriever", async () => {
      try {
        run.value = await task.readCache();
        if (run.value !== null) run.cacheStatus = "hit";
      } catch (error) {
        // An unreadable cache is not a reason to refuse the request.
        console.error(`AI cache read failed for ${task.task}:`, error);
        run.cacheStatus = "read-failed";
      }
      return { cacheStatus: run.cacheStatus };
    });

    if (run.value === null) {
      let prepared: Prepared | null = null;
      try {
        prepared = await task.prepare();
      } catch (error) {
        if (!(error instanceof AiInputError)) {
          console.error(`AI input for ${task.task} could not be assembled:`, error);
        }
        run.failure = {
          outcome: "input-failed",
          summary: `Input not assembled: ${describe(error)}`,
          message:
            error instanceof AiInputError
              ? error.message
              : "What the model needs could not be put together. The details were logged on the server.",
        };
      }

      if (prepared !== null) {
        const input = prepared;
        const answer: { text: string | null } = { text: null };
        await environment.span("model-call", "llm", async () => {
          run.modelCalled = true;
          try {
            const completion = await task.callModel(input);
            answer.text = completion.text;
            run.usage = completion.usage;
          } catch (error) {
            console.error(`AI model call failed for ${task.task}:`, error);
            run.failure = {
              outcome: "model-failed",
              summary: `Model call failed: ${describe(error)}`,
              message: `The model call failed (${describe(error)}). Nothing was saved.`,
            };
          }
          return {
            model: task.model,
            failed: answer.text === null,
            inputTokens: run.usage?.inputTokens ?? null,
            outputTokens: run.usage?.outputTokens ?? null,
          };
        });

        if (answer.text !== null) {
          run.value = task.accept(answer.text, input);
          if (run.value === null) {
            run.failure = {
              outcome: "rejected",
              summary: "The model's answer did not pass validation.",
              message: "The model's answer was not usable, so it was discarded.",
            };
          } else {
            try {
              await task.writeCache(run.value);
            } catch (error) {
              // The answer is still good; it just will not be there next time.
              console.error(`AI cache write failed for ${task.task}:`, error);
              if (run.cacheStatus !== "read-failed") run.cacheStatus = "write-failed";
            }
          }
        }
      }
    }

    return {
      subject: task.subject,
      inputHash: task.inputHash,
      promptVersion: task.promptVersion,
      cacheStatus: run.cacheStatus,
      modelCalled: run.modelCalled,
      outcome: run.failure?.outcome ?? "succeeded",
    };
  });

  // A run with no model call used no tokens. A run with one used what the
  // provider reported, or an unknown amount.
  const tokens: TokenUsage = run.modelCalled ? run.usage : { inputTokens: 0, outputTokens: 0 };
  let traceRecorded = true;
  try {
    await environment.record({
      task: task.task,
      subject: task.subject,
      model: task.model,
      promptVersion: task.promptVersion,
      inputHash: task.inputHash,
      cacheStatus: run.cacheStatus,
      outcome: run.failure?.outcome ?? "succeeded",
      modelCalled: run.modelCalled,
      inputTokens: tokens?.inputTokens ?? null,
      outputTokens: tokens?.outputTokens ?? null,
      errorSummary: run.failure?.summary.slice(0, 300) ?? null,
      externalTrace: environment.externalTrace,
      startedAt: startedAt.toISOString(),
      finishedAt: environment.now().toISOString(),
    });
  } catch (error) {
    console.error(`The trace record for ${task.task} could not be written:`, error);
    traceRecorded = false;
  }

  if (run.failure) {
    return { ok: false, outcome: run.failure.outcome, message: run.failure.message, traceRecorded };
  }
  if (run.value === null) throw new Error("An AI run ended with neither a value nor a failure.");
  return { ok: true, value: run.value, cacheStatus: run.cacheStatus, traceRecorded };
}
