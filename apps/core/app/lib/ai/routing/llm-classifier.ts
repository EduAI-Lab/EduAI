/**
 * P3 — LLM tier classifier (dedicated router call on tier-1 vLLM).
 * Used when the client requests `model=auto-llm` or `ROUTER_MODE=llm`.
 */
import { generateText } from "ai";
import { z } from "zod";
import { isLocalVllmRouting } from "./local-vllm";
import { createClassifierClient } from "./classifier-client";
import { hasStrongRagHit } from "./rules";

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
Return JSON only with fields: task, complexity, confidence (integer 0-100, NOT 0-1).

task:
- chat: general Q&A, definitions, explanations
- coding: programming, debugging, algorithms
- analysis: compare, evaluate, multi-part reasoning
- creative: writing, brainstorming

complexity:
- low: short factual, formatting, simple lookup, brief summary
- medium: standard coursework, moderate reasoning, typical problem sets
- high: multi-step proofs, difficult debugging, ambiguous or high-stakes work

Retrieved course context:
The routing signals include whether course material was retrieved for this
prompt and how well it matched (rag_top_similarity, 0-1; higher is a closer
match). When rag_top_similarity is above 0.8 with at least one chunk, the
answer is largely contained in material already supplied to the answering
model. Rate such prompts one complexity level LOWER than the wording alone
suggests: a "compare X and Y" question whose comparison is already laid out
in the retrieved notes is a low-complexity retrieval-and-restate task, not
multi-step reasoning.

Cost asymmetry:
The large tier costs substantially more latency and energy on every turn. A
separate rule stack already escalates prompts with clear lexical markers of
difficulty before you are consulted, so prompts reaching you have already
been judged not-obviously-hard. Rate complexity "high" only when the prompt
genuinely requires multi-step derivation that retrieved material does not
supply. Routine coursework in a technical subject is "medium", not "high",
merely because its topic is programming or analysis.

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

/**
 * Map classifier output → tier (1 / 2 / 3). Exported for tests.
 *
 * `task` modulates the tier decision rather than short-circuiting it: a
 * medium-complexity coding/analysis prompt no longer escalates on task
 * label alone (see RUN_LOG / PR description for the 2026-08 "auto-llm tier
 * drift" investigation this replaced) — it escalates only when the prompt
 * is also NOT already answerable from strongly-matched retrieved course
 * context, mirroring `rule4_strong_rag_tier_1`/`rule4b_moderate_rag_tier_1`
 * in rules.ts (v3 rule-stack re-tuning, PR #1403). The rule stack already
 * demonstrated that a bare topic/task-word gate over-escalates routine
 * coursework; this function previously used exactly that pattern.
 */
export function tierFromLlmClassification(
  classification: LlmRouteClassification,
  ragContext?: Pick<LlmClassifierContext, "ragTopSimilarity" | "ragChunkCount">,
): 1 | 2 | 3 {
  const small: 1 | 2 = isLocalVllmRouting() ? 1 : 2;
  const minConf = classifierMinConfidence();

  if (classification.confidence < minConf) {
    // Uncertainty routes to the small tier, deliberately: in production
    // this function only ever sees prompts the rule stack already declined
    // to escalate (resolveRoutedModelLlm runs rules first), so an uncertain
    // classifier should not override that judgement in the escalating
    // direction. This is an intentional sustainability-favoring default,
    // not an oversight.
    return small;
  }

  if (classification.complexity === "low") {
    return 1;
  }

  // Delegates to the same predicate rule4_strong_rag_tier_1 uses, so the
  // rule stack and the classifier path can't silently disagree on what
  // "strong RAG" means (see hasStrongRagHit's doc comment).
  const strongRag = hasStrongRagHit({
    ragTopSimilarity: ragContext?.ragTopSimilarity ?? null,
    ragChunkCount: ragContext?.ragChunkCount ?? null,
  });

  if (classification.complexity === "medium") {
    // Strong course-RAG retrieval means the answer is largely present in
    // the supplied context, easing an otherwise coding/analysis-flavored
    // prompt. Task label alone no longer forces escalation here. Both
    // outcomes route through `small` (not a literal tier) so this stays
    // deployment-aware, same as the confidence gate above and the
    // high-complexity branch below.
    return small;
  }

  // complexity === "high"
  if (strongRag && classification.task !== "coding") {
    // Retrieval-answerable high-complexity non-coding work still benefits
    // from the small tier when the context is strong. Coding tasks keep
    // escalating at "high" regardless of RAG, since strong similarity on a
    // code-generation prompt does not mean the code itself is already
    // written in the retrieved material.
    return small;
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
