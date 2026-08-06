/**
 * Shared OpenAI-compatible client for single-shot classifier calls against the
 * tier-1 vLLM host (routing classifier, course-scope guardrail). Bypasses the
 * fleet round-robin and admission semaphore — same fixed host every call.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { vllmThinkingDisabledFetch } from "~/lib/ai/vllm-thinking.server";

export function createClassifierClient() {
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
