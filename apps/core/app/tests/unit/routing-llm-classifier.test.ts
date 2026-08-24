import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  tierFromLlmClassification,
  parseClassifierJson,
  type LlmRouteClassification,
} from "~/lib/ai/routing/llm-classifier";

describe("tierFromLlmClassification", () => {
  const base: LlmRouteClassification = {
    task: "chat",
    complexity: "low",
    confidence: 90,
  };

  afterEach(() => {
    delete process.env.ROUTING_LLM_MIN_CONFIDENCE;
    delete process.env.VLLM_BASE_URL;
    delete process.env.ROUTING_LOCAL_VLLM_ONLY;
    delete process.env.ROUTING_RAG_STRONG_SIM;
  });

  it("maps low complexity with high confidence to tier 1", () => {
    expect(tierFromLlmClassification(base)).toBe(1);
  });

  it("maps medium complexity to tier 1 on local vLLM for chat task", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    expect(tierFromLlmClassification({ ...base, complexity: "medium" })).toBe(1);
  });

  it("no longer force-escalates medium coding task on task label alone (post-drift-fix)", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    expect(
      tierFromLlmClassification({
        ...base,
        task: "coding",
        complexity: "medium",
      }),
    ).toBe(1);
  });

  it("maps medium complexity to the small tier regardless of RAG strength (task label alone never escalates)", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    expect(
      tierFromLlmClassification(
        { ...base, task: "coding", complexity: "medium" },
        { ragTopSimilarity: 0.4, ragChunkCount: 1 },
      ),
    ).toBe(1);
  });

  it("stays on the small tier for medium complexity when RAG context is strong too (no separate strong-RAG path at this complexity)", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    expect(
      tierFromLlmClassification(
        { ...base, task: "analysis", complexity: "medium" },
        { ragTopSimilarity: 0.85, ragChunkCount: 3 },
      ),
    ).toBe(1);
  });

  it("keeps tier 1 when confidence is below threshold on local vLLM", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    process.env.ROUTING_LLM_MIN_CONFIDENCE = "80";
    expect(tierFromLlmClassification({ ...base, complexity: "low", confidence: 50 })).toBe(1);
  });

  it("maps high complexity to tier 3 by default", () => {
    expect(tierFromLlmClassification({ ...base, complexity: "high" })).toBe(3);
  });

  it("de-escalates high complexity non-coding task to small tier when RAG context is strong", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    expect(
      tierFromLlmClassification(
        { ...base, task: "analysis", complexity: "high" },
        { ragTopSimilarity: 0.9, ragChunkCount: 2 },
      ),
    ).toBe(1);
  });

  it("keeps high-complexity coding task escalated even with strong RAG context", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    expect(
      tierFromLlmClassification(
        { ...base, task: "coding", complexity: "high" },
        { ragTopSimilarity: 0.9, ragChunkCount: 2 },
      ),
    ).toBe(3);
  });

  it("does not treat strong similarity with zero chunks as strong RAG (non-vLLM: falls to tier 2, not 1)", () => {
    // Distinguishing the two "medium" paths requires the non-local-vLLM
    // small tier (2), since local vLLM's small tier (1) is the same value
    // both the strong-RAG de-escalation and the generic fallback return.
    delete process.env.VLLM_BASE_URL;
    expect(
      tierFromLlmClassification(
        { ...base, task: "analysis", complexity: "medium" },
        { ragTopSimilarity: 0.9, ragChunkCount: 0 },
      ),
    ).toBe(2); // generic small-tier fallback, not the strong-RAG path — no chunks retrieved
  });
});

describe("tierFromLlmClassification false-positive guardrail", () => {
  // Mirrors routing-rules-fp-guardrail.test.ts's guard on the regex rule
  // stack: a fixed table of realistic classifier outputs for routine,
  // easy coursework that must NOT escalate to tier 3. Before the 2026-08
  // fix, `task === "coding" || task === "analysis"` alone forced tier 3
  // here regardless of complexity or RAG context, over-escalating exactly
  // this kind of routine traffic.
  const easyCases: Array<{
    label: string;
    classification: LlmRouteClassification;
    ragContext?: { ragTopSimilarity: number; ragChunkCount: number };
  }> = [
    {
      label: "low-complexity coding prompt",
      classification: { task: "coding", complexity: "low", confidence: 90 },
    },
    {
      label: "low-complexity analysis prompt",
      classification: { task: "analysis", complexity: "low", confidence: 90 },
    },
    {
      label: "medium-complexity coding prompt answerable from strong RAG context",
      classification: { task: "coding", complexity: "medium", confidence: 90 },
      ragContext: { ragTopSimilarity: 0.9, ragChunkCount: 2 },
    },
    {
      label: "medium-complexity analysis prompt answerable from strong RAG context",
      classification: { task: "analysis", complexity: "medium", confidence: 90 },
      ragContext: { ragTopSimilarity: 0.82, ragChunkCount: 1 },
    },
    {
      label: "high-complexity analysis prompt fully answerable from strong RAG context",
      classification: { task: "analysis", complexity: "high", confidence: 90 },
      ragContext: { ragTopSimilarity: 0.95, ragChunkCount: 4 },
    },
  ];

  beforeEach(() => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
  });

  afterEach(() => {
    delete process.env.VLLM_BASE_URL;
  });

  it.each(easyCases.map((c) => [c.label, c]))("does not escalate: %s", (_label, c) => {
    const result = tierFromLlmClassification(c.classification, c.ragContext);
    expect(result).toBe(1);
  });
});

describe("parseClassifierJson", () => {
  it("parses bare JSON object", () => {
    const out = parseClassifierJson('{"task":"coding","complexity":"medium","confidence":85}');
    expect(out.task).toBe("coding");
    expect(out.complexity).toBe("medium");
    expect(out.confidence).toBe(85);
  });

  it("extracts JSON from surrounding text", () => {
    const out = parseClassifierJson(
      'Here is the result:\n{"task":"chat","complexity":"low","confidence":92}\n',
    );
    expect(out.complexity).toBe("low");
  });
});
