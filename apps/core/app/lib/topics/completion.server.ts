import type { SupportedProvider } from "~/lib/ai/provider-types";
import { runCompletion } from "~/lib/ai/completion.server";
import type { RunTopicCompletion } from "~/lib/topics/provision.server";

/** Model used when nothing else is configured — matches the async-worker default. */
const DEFAULT_TOPIC_ANALYSIS_MODEL = "vllm:qwen2.5-32b-instruct";

/** Topic lists are short; a low cap also bounds how much a runaway model can cost. */
const TOPIC_ANALYSIS_MAX_TOKENS = 1024;

const DEFAULT_TIMEOUT_MS = 60_000;

type ServerProviderKeys = {
  [K in SupportedProvider]?: { isEnabled: boolean; apiKey?: string };
};

/**
 * Server-held credentials for the chosen model. Mirrors the async worker: topic
 * analysis runs with no user present, so browser-supplied keys are never in play.
 */
function serverApiKeys(model: string): ServerProviderKeys {
  if (model.startsWith("openai:") && process.env.OPENAI_API_KEY) {
    return { openai: { isEnabled: true, apiKey: process.env.OPENAI_API_KEY } };
  }
  if (model.startsWith("google:") && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { google: { isEnabled: true, apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY } };
  }
  return {};
}

function topicAnalysisModel(): string {
  return (
    process.env.TOPIC_ANALYSIS_MODEL?.trim() ||
    process.env.AI_JOB_DEFAULT_MODEL?.trim() ||
    DEFAULT_TOPIC_ANALYSIS_MODEL
  );
}

/**
 * Ask a model for topic names, returning its raw text or null.
 *
 * Returns null rather than throwing on a refused or failed completion: the AI
 * path is already the last resort, and "the model gave us nothing" is a
 * no-topics outcome the caller handles with the zero-topic fallback — not a
 * reason to fail the whole job and lose the deterministic work alongside it.
 */
export const runTopicAnalysisCompletion: RunTopicCompletion = async ({ systemPrompt, prompt }) => {
  const model = topicAnalysisModel();

  const completion = await runCompletion({
    model,
    apiKeys: serverApiKeys(model),
    systemPrompt,
    messages: [{ role: "user", content: prompt }],
    streaming: false,
    maxTokens: TOPIC_ANALYSIS_MAX_TOKENS,
    routingContext: { jobType: "background" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!completion.ok || completion.streaming) return null;
  return completion.body.content ?? null;
};
