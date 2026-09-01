import { describe, expect, it } from "vitest";
import {
  campusProbeParams,
  pickCampusProbeFromCatalog,
  pickPreferredGenerationFromCatalog,
} from "../../src/services/modelCatalog.js";

describe("modelCatalog", () => {
  const catalog = [
    { provider: "vllm", modelId: "qwen3.5-9b-instruct", name: "9B", isActive: true },
    { provider: "vllm", modelId: "qwen3.5-2b-instruct", name: "2B", isActive: true },
    { provider: "google", modelId: "gemini-2.5-flash", name: "Gemini", isActive: true },
  ];

  it("picks the smallest campus model for probes", () => {
    expect(pickCampusProbeFromCatalog(catalog)?.id).toBe("vllm:qwen3.5-2b-instruct");
  });

  it("picks the largest campus model for generation defaults", () => {
    expect(pickPreferredGenerationFromCatalog(catalog)?.id).toBe("vllm:qwen3.5-9b-instruct");
  });

  it("builds probe params from the catalog", () => {
    expect(campusProbeParams(catalog)).toEqual({
      provider: "vllm",
      model: "vllm:qwen3.5-2b-instruct",
      apiKeys: { vllm: { isEnabled: true } },
    });
  });
});
