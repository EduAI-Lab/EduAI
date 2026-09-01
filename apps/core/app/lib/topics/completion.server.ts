import type { SupportedProvider } from "~/lib/ai/provider-types";
import { runCompletion } from "~/lib/ai/completion.server";
import { asFiniteNumber } from "~/lib/json-value";
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
 * Raised when the provider itself could not be reached or refused the request.
 *
 * Distinct from a model that simply had nothing to say: the first is a failure
 * the instructor must be told about and offered a retry for, the second is an
 * ordinary empty result. Collapsing them — as returning null for both did —
 * recorded a misconfigured or unreachable provider as a COMPLETED job with zero
 * topics, so the promised failure notification never appeared.
 */
export class TopicAnalysisProviderError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TopicAnalysisProviderError";
    this.status = status;
  }
}

/**
 * Ask a model for topic names, returning its raw text or null.
 *
 * Null means the model answered with nothing usable — a no-topics outcome the
 * caller handles with the zero-topic fallback. A provider or configuration
 * failure throws instead, which fails the job row and gives the instructor the
 * banner's retry action. Nothing deterministic is lost either way: this path
 * only runs when Canvas modules and material headings both came up empty.
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

  if (!completion.ok) {
    const status = "status" in completion ? completion.status : undefined;
    const detail = "error" in completion && completion.error ? String(completion.error) : "unknown";
    throw new TopicAnalysisProviderError(
      `Topic analysis provider call failed (${model}): ${detail}`,
      asFiniteNumber(status) ?? undefined,
    );
  }

  // A streaming body cannot be read here, and asking for one was a programming
  // error rather than a model outcome — surface it as a failure, not as silence.
  if (completion.streaming) {
    throw new TopicAnalysisProviderError(
      `Topic analysis provider returned a streaming response for ${model}`,
    );
  }

  return completion.body.content ?? null;
};
