import { describe, expect, it } from "vitest";
import {
  buildAdhdAssistStructuredResponseSchema,
  isStructuredAdhdAssistCandidate,
  parseAdhdStructuredResponse,
  renderAdhdStructuredResponse,
  resolveRequestedAssistStageCount,
} from "~/lib/ai/adhd-structured-output";

const structured = JSON.stringify({
  title: "Gradient descent",
  answer: "The optimizer lowers error by following the slope downhill.",
  stages: [
    { label: "Start point", detail: "Pick initial parameter values." },
    { label: "Compute gradient", detail: "Measure the uphill direction." },
    { label: "Step downhill", detail: "Move opposite the gradient." },
    { label: "Repeat to minimum", detail: "Continue until the loss is small." },
  ],
  tldr: "Follow the slope downhill, one measured step at a time.",
  next: "try one update yourself",
});

describe("structured Assist output", () => {
  it("accepts complete constrained model output", () => {
    expect(parseAdhdStructuredResponse(structured)?.stages).toHaveLength(4);
  });

  it("renders one canonical ladder and diagram from the same stages", () => {
    const rendered = renderAdhdStructuredResponse({
      text: structured,
      userText: "Draw a diagram of gradient descent",
    });

    expect(rendered).toContain("### Step ladder");
    expect(rendered).toContain("```eduai-diagram");
    expect(rendered).toContain("Start point");
    expect(rendered).toContain("Repeat to minimum");
    expect(rendered?.match(/^\d+\./gm)).toHaveLength(4);
    expect(rendered?.indexOf("### Step ladder")).toBeLessThan(
      rendered?.indexOf("```eduai-diagram") ?? 0,
    );
  });

  it("uses the structured path for full-tutoring vLLM Assist turns", () => {
    expect(
      isStructuredAdhdAssistCandidate({
        modelIdentifier: "vllm:qwen3.5-2b-instruct",
        adhdAssist: true,
        imagesPresent: false,
        chatMode: "learning",
        profile: "full_tutoring",
        toolsEnabled: false,
      }),
    ).toBe(true);
  });

  it("keeps structure for explicit 2B/9B Assist even without a diagram", () => {
    expect(
      isStructuredAdhdAssistCandidate({
        modelIdentifier: "vllm:qwen3.5-9b-instruct",
        adhdAssist: true,
        imagesPresent: false,
        chatMode: "learning",
        profile: "full_tutoring",
        toolsEnabled: false,
      }),
    ).toBe(true);
  });

  it("constrains an explicitly requested stage count", () => {
    expect(
      resolveRequestedAssistStageCount(
        "Explain gradient descent visually with exactly five ordered stages.",
      ),
    ).toBe(5);
    expect(resolveRequestedAssistStageCount("show the four steps")).toBe(4);
    expect(
      resolveRequestedAssistStageCount("explain this visually"),
    ).toBeNull();

    const schema = buildAdhdAssistStructuredResponseSchema(5);
    expect(schema.properties.stages.minItems).toBe(5);
    expect(schema.properties.stages.maxItems).toBe(5);
  });

  it("does not truncate an explicitly requested flow as a two-sided comparison", () => {
    const rendered = renderAdhdStructuredResponse({
      text: structured,
      userText:
        "Explain binary search visually with exactly four ordered stages.",
    });

    expect(rendered?.match(/^\d+\./gm)).toHaveLength(4);
    expect(rendered).toContain("```eduai-diagram\nprocess-flow");
  });

  it("does not use structured output for images or tool turns", () => {
    const base = {
      modelIdentifier: "vllm:qwen3.5-9b-instruct",
      adhdAssist: true,
      imagesPresent: false,
      chatMode: "learning" as const,
      profile: "full_tutoring" as const,
    };
    expect(
      isStructuredAdhdAssistCandidate({ ...base, imagesPresent: true }),
    ).toBe(false);
    expect(
      isStructuredAdhdAssistCandidate({ ...base, toolsEnabled: true }),
    ).toBe(false);
  });
});
