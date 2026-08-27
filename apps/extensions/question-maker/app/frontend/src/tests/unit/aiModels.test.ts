/**
 * Unit tests for AI model selection helpers (#1546): campus-model detection
 * and the preferred generation/probe model heuristics.
 */
import { describe, expect, it } from "vitest";
import {
  FALLBACK_GENERATION_MODEL,
  isCampusModel,
  pickCampusProbeModel,
  pickPreferredGenerationModel,
} from "@/utils/aiModels";
import type { EduAIModelOption } from "@/services/eduaiService";

function model(partial: Partial<EduAIModelOption> & Pick<EduAIModelOption, "id">): EduAIModelOption {
  return { label: partial.id, provider: "openai", ...partial } as EduAIModelOption;
}

describe("isCampusModel", () => {
  it("is true for vllm/ollama providers", () => {
    expect(isCampusModel(model({ id: "x", provider: "vllm" }))).toBe(true);
    expect(isCampusModel(model({ id: "y", provider: "ollama" }))).toBe(true);
  });

  it("is true when the id is prefixed even with a different provider field", () => {
    expect(isCampusModel(model({ id: "vllm:qwen", provider: "other" }))).toBe(true);
  });

  it("is false for a cloud provider/id", () => {
    expect(isCampusModel(model({ id: "gpt-4", provider: "openai" }))).toBe(false);
  });
});

describe("pickPreferredGenerationModel", () => {
  it("falls back to the default when the catalog is empty", () => {
    expect(pickPreferredGenerationModel([])).toBe(FALLBACK_GENERATION_MODEL);
  });

  it("prefers the largest campus model when campus models exist", () => {
    const models = [
      model({ id: "vllm:qwen2.5-7b-instruct", provider: "vllm" }),
      model({ id: "vllm:qwen2.5-32b-instruct", provider: "vllm" }),
      model({ id: "openai:gpt-4", provider: "openai" }),
    ];
    expect(pickPreferredGenerationModel(models)).toBe("vllm:qwen2.5-32b-instruct");
  });

  it("falls back to the first catalog entry when no campus models are present", () => {
    const models = [model({ id: "openai:gpt-4", provider: "openai" })];
    expect(pickPreferredGenerationModel(models)).toBe("openai:gpt-4");
  });
});

describe("pickCampusProbeModel", () => {
  it("returns null when there are no campus models", () => {
    const models = [model({ id: "openai:gpt-4", provider: "openai" })];
    expect(pickCampusProbeModel(models)).toBeNull();
  });

  it("prefers the smallest campus model", () => {
    const small = model({ id: "vllm:qwen2.5-7b-instruct", provider: "vllm" });
    const large = model({ id: "vllm:qwen2.5-32b-instruct", provider: "vllm" });
    expect(pickCampusProbeModel([large, small])).toEqual(small);
  });

  it("treats an unranked campus model as large (rank fallback 999)", () => {
    const unranked = model({ id: "vllm:mystery-model", provider: "vllm" });
    const ranked = model({ id: "vllm:qwen2.5-7b-instruct", provider: "vllm" });
    expect(pickCampusProbeModel([unranked, ranked])).toEqual(ranked);
  });
});
