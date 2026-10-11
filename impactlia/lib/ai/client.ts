import "server-only";
import { Client as LangSmith } from "langsmith";
import { traceable } from "langsmith/traceable";
import OpenAI from "openai";
import { MODEL } from "@/lib/ai/config";
import type { Prompt } from "@/lib/ai/prompts";
import {
  runTraced,
  type Span,
  type TokenUsage,
  type TraceRecord,
  type TracedResult,
  type TracedTask,
} from "@/lib/ai/traced";
import { env } from "@/lib/env";

// The only place a model client is constructed, and the only way to reach it.
// The client itself is not exported: what leaves this file is `runAiTask`,
// which cannot call a model except inside a traced, cached operation. The
// provider's name appears nowhere else in the application.

// Without a key there is no client, and the application still runs: nothing
// but the explanations needs a model. A request for one then fails as a
// recorded model failure, like any other.
const openai = env.openaiApiKey
  ? new OpenAI({ apiKey: env.openaiApiKey, maxRetries: 1, timeout: 60_000 })
  : null;

// LangSmith reads its endpoint from LANGSMITH_ENDPOINT when that is set, which
// is how a workspace outside the default region is reached.
const langsmith = env.langsmithApiKey ? new LangSmith({ apiKey: env.langsmithApiKey }) : null;
const LANGSMITH_PROJECT = "impactlia";

// Whether runs are also sent to LangSmith. They are recorded in the database
// either way.
export const externalTracing = langsmith !== null;

// One step of a run, as LangSmith sees it. The step takes no arguments and
// returns only a few plain facts, so a trace holds no prompt, no source code
// and no model output. Nested steps attach to the step that is running.
const span: Span = async (name, type, step) => {
  if (!langsmith) {
    await step();
    return;
  }
  await traceable(step, {
    name,
    run_type: type,
    client: langsmith,
    project_name: LANGSMITH_PROJECT,
    tracingEnabled: true,
    metadata: { model: MODEL },
  })();
};

async function complete(prompt: Prompt): Promise<{ text: string; usage: TokenUsage }> {
  if (!openai) throw new Error("OPENAI_API_KEY is not set, so no model was called.");
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_completion_tokens: prompt.maxOutputTokens,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  const { usage } = completion;
  return {
    text: completion.choices[0]?.message.content ?? "",
    usage: usage
      ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
      : null,
  };
}

export type AiTaskRequest<Prepared, Value> = Omit<
  TracedTask<Prepared, Value>,
  "model" | "callModel"
> & {
  prompt: (prepared: Prepared) => Prompt;
};

export async function runAiTask<Prepared, Value>(
  request: AiTaskRequest<Prepared, Value>,
  record: (trace: TraceRecord) => Promise<void>,
): Promise<TracedResult<Value>> {
  const { prompt, ...task } = request;
  const result = await runTraced(
    { ...task, model: MODEL, callModel: (prepared) => complete(prompt(prepared)) },
    { now: () => new Date(), span, externalTrace: externalTracing, record },
  );
  // The request may end before LangSmith's background upload does.
  await langsmith?.awaitPendingTraceBatches().catch((error: unknown) => {
    console.error("Traces could not be sent to LangSmith:", error);
  });
  return result;
}
