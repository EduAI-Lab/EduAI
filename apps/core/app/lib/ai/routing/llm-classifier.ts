/**
 * P3 — LLM tier classifier (dedicated router call on tier-1 vLLM).
 * Used when the client requests `model=auto-llm` or `ROUTER_MODE=llm`.
 */
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { isLocalVllmRouting } from "./local-vllm";
import { vllmThinkingDisabledFetch } from "~/lib/ai/vllm-thinking.server";

export type LlmClassifierContext = {
  courseId: string | null;
  imagesPresent: boolean;
  ragTopSimilarity?: number | null;
  ragChunkCount?: number | null;
  ragContextTokenEstimate?: number | null;
  courseRagNeeded?: boolean;
};

export const routeTaskSchema = z.enum(["chat", "coding", "analysis", "creative"]);
export const routeComplexitySchema = z.enum(["low", "medium", "high"]);

export const llmRouteSchema = z.object({
  task: routeTaskSchema,
  complexity: routeComplexitySchema,
  confidence: z.number().min(0).max(100),
});

export type LlmRouteClassification = z.infer<typeof llmRouteSchema>;

const CLASSIFIER_SYSTEM = `You are a routing classifier for a university course assistant.
Choose the smallest adequate model tier for the student prompt.
Return JSON only with fields: task, complexity, confidence (0-100).

task:
- chat: general Q&A, definitions, explanations
- coding: programming, debugging, algorithms
- analysis: compare, evaluate, multi-part reasoning
- creative: writing, brainstorming

complexity:
- low: short factual, formatting, simple lookup, brief summary
- medium: standard coursework, moderate reasoning, typical problem sets
- high: multi-step proofs, difficult debugging, ambiguous or high-stakes work

confidence: how sure you are about complexity (not answer quality).

Respond with a single JSON object only (no markdown fences):
{"task":"chat|coding|analysis|creative","complexity":"low|medium|high","confidence":0-100}`;

/** Parse classifier JSON from model text (vLLM lacks tool-call-parser for generateObject). */
export function parseClassifierJson(text: string): LlmRouteClassification {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Classifier response contained no JSON object");
  }
  const parsed = llmRouteSchema.safeParse(JSON.parse(jsonMatch[0]));
  if (!parsed.success) {
    throw new Error(`Classifier JSON invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

function classifierModelId(): string {
  return (
    process.env.ROUTING_LLM_CLASSIFIER_MODEL?.trim() || "qwen2.5-7b-instruct"
  );
}

function classifierMinConfidence(): number {
  const n = Number(process.env.ROUTING_LLM_MIN_CONFIDENCE ?? "60");
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 60;
}

function classifierTimeoutMs(): number {
  const n = Number(process.env.ROUTING_LLM_CLASSIFIER_TIMEOUT_MS ?? "30000");
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

function createClassifierClient() {
  const vllmPort = process.env.VLLM_PORT || "8001";
  let baseURL =
    process.env.VLLM_BASE_URL?.trim() || `http://localhost:${vllmPort}`;
  baseURL = baseURL.replace(/\/$/, "");
  if (!baseURL.endsWith("/v1")) {
    baseURL = `${baseURL}/v1`;
  }
  const apiKey = process.env.VLLM_API_KEY?.trim() || "vllm-local";
  return createOpenAI({
    baseURL,
    apiKey,
    compatibility: "strict",
    fetch: vllmThinkingDisabledFetch(),
  });
}

function buildClassifierUserPrompt(
  prompt: string,
  context: LlmClassifierContext,
): string {
  const lines = [
    "Student prompt:",
    prompt.trim(),
    "",
    "Routing signals:",
    `- course_selected: ${context.courseId != null}`,
    `- course_rag_needed: ${context.courseRagNeeded === true}`,
    `- rag_top_similarity: ${context.ragTopSimilarity ?? "unknown"}`,
    `- rag_chunk_count: ${context.ragChunkCount ?? "unknown"}`,
    `- rag_context_tokens_est: ${context.ragContextTokenEstimate ?? "unknown"}`,
    `- images_present: ${context.imagesPresent}`,
  ];
  return lines.join("\n");
}

/** Map classifier output → tier (1 / 2 / 3). Exported for tests. */
export function tierFromLlmClassification(
  classification: LlmRouteClassification,
): 1 | 2 | 3 {
  const minConf = classifierMinConfidence();
  if (classification.confidence < minConf) {
    // Two-tier vLLM stack: prefer 7B when classifier is uncertain.
    return isLocalVllmRouting() ? 1 : 2;
  }

  if (classification.complexity === "low") {
    return 1;
  }
  if (classification.task === "coding" || classification.task === "analysis") {
    return 3;
  }
  if (classification.complexity === "medium") {
    return isLocalVllmRouting() ? 1 : 2;
  }
  return 3;
}

export async function classifyPromptForTier(
  prompt: string,
  context: LlmClassifierContext,
): Promise<LlmRouteClassification> {
  const openai = createClassifierClient();
  const model = openai(classifierModelId());

  const { text } = await generateText({
    model,
    system: CLASSIFIER_SYSTEM,
    prompt: buildClassifierUserPrompt(prompt, context),
    temperature: 0,
    maxTokens: 128,
    abortSignal: AbortSignal.timeout(classifierTimeoutMs()),
  });

  return parseClassifierJson(text);
}
