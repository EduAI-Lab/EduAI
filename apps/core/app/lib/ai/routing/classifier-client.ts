/**
 * Shared OpenAI-compatible client for single-shot classifier calls against the
 * tier-1 vLLM host (routing classifier, course-scope guardrail). Bypasses the
 * fleet round-robin and admission semaphore — same fixed host every call.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { resolveVllmApiKey } from "~/lib/ai/vllm-api-key.server";
import { vllmThinkingDisabledFetch } from "~/lib/ai/vllm-thinking.server";

export function createClassifierClient() {
  const vllmPort = process.env.VLLM_PORT || "8001";
  let baseURL =
    process.env.VLLM_BASE_URL?.trim() || `http://localhost:${vllmPort}`;
  baseURL = baseURL.replace(/\/$/, "");
  if (!baseURL.endsWith("/v1")) {
    baseURL = `${baseURL}/v1`;
  }
  const apiKey = resolveVllmApiKey();
  if (!apiKey) {
    throw new Error("VLLM_API_KEY is required in production (no vllm-local fallback)");
  }
  return createOpenAI({
    baseURL,
    apiKey,
    compatibility: "strict",
    fetch: vllmThinkingDisabledFetch(),
  });
}
