/**
 * Unit tests for `assessmentVariantService` (#1546): reference-exam variant
 * workflow client, including the apiKeys payload assembly for model-backed calls.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const buildApiKeysForModel = vi.fn();

vi.mock("../../services/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));

vi.mock("../../services/apiKeyStorage", () => ({
  apiKeyStorage: {
    buildApiKeysForModel: (...args: unknown[]) => buildApiKeysForModel(...args),
  },
}));

import { assessmentVariantService } from "../../services/assessmentVariantService";

afterEach(() => {
  vi.clearAllMocks();
});

describe("assessmentVariantService.setStudyRole", () => {
  it("patches the role and returns data", async () => {
    patch.mockResolvedValue({ data: { data: { blueprintConfig: { a: 1 } } } });
    const result = await assessmentVariantService.setStudyRole(1, "reference_baseline");
    expect(patch).toHaveBeenCalledWith("/api/assessment-variant/assessments/1/role", {
      studyRole: "reference_baseline",
    });
    expect(result).toEqual({ blueprintConfig: { a: 1 } });
  });
});

describe("assessmentVariantService.getBlueprintSnapshot", () => {
  it("fetches the snapshot", async () => {
    get.mockResolvedValue({ data: { data: { assessmentId: 1 } } });
    const result = await assessmentVariantService.getBlueprintSnapshot(1);
    expect(get).toHaveBeenCalledWith("/api/assessment-variant/assessments/1/blueprint-snapshot");
    expect(result).toEqual({ assessmentId: 1 });
  });
});

describe("assessmentVariantService.getBaselineVariantReadiness", () => {
  it("fetches readiness scoped to a course", async () => {
    get.mockResolvedValue({ data: { data: { allReady: true } } });
    const result = await assessmentVariantService.getBaselineVariantReadiness(1, 2);
    expect(get).toHaveBeenCalledWith("/api/assessment-variant/assessments/1/variant-readiness", {
      params: { courseId: 2 },
    });
    expect(result).toEqual({ allReady: true });
  });
});

describe("assessmentVariantService.assembleEquivalentExams / assembleExamsByMetadataSimilarity", () => {
  it("posts the payload for assembleEquivalentExams", async () => {
    post.mockResolvedValue({ data: { data: { referenceAssessmentId: 1 } } });
    const payload = { referenceAssessmentId: 1, courseId: 2 };
    await assessmentVariantService.assembleEquivalentExams(payload);
    expect(post).toHaveBeenCalledWith("/api/assessment-variant/assemble-variants", payload);
  });

  it("posts the payload for assembleExamsByMetadataSimilarity", async () => {
    post.mockResolvedValue({ data: { data: { referenceAssessmentId: 1 } } });
    const payload = { referenceAssessmentId: 1, courseId: 2 };
    await assessmentVariantService.assembleExamsByMetadataSimilarity(payload);
    expect(post).toHaveBeenCalledWith("/api/assessment-variant/assemble-by-metadata", payload);
  });
});

describe("assessmentVariantService.generateBankVariants", () => {
  it("defaults the model and merges built apiKeys into the request", async () => {
    buildApiKeysForModel.mockResolvedValue({ vllm: { isEnabled: true } });
    post.mockResolvedValue({ data: { data: { results: [], errors: [], courseId: 1 } } });

    await assessmentVariantService.generateBankVariants({ courseId: 1, questionIds: [1, 2] });

    expect(buildApiKeysForModel).toHaveBeenCalledWith("vllm:qwen2.5-32b-instruct");
    expect(post).toHaveBeenCalledWith("/api/assessment-variant/generate-bank-variants", {
      courseId: 1,
      questionIds: [1, 2],
      model: "vllm:qwen2.5-32b-instruct",
      apiKeys: { vllm: { isEnabled: true } },
    });
  });

  it("respects an explicit model override", async () => {
    buildApiKeysForModel.mockResolvedValue({ google: { apiKey: "k", isEnabled: true } });
    post.mockResolvedValue({ data: { data: { results: [], errors: [], courseId: 1 } } });

    await assessmentVariantService.generateBankVariants({
      courseId: 1,
      questionIds: [1],
      model: "google:gemini",
    });

    expect(buildApiKeysForModel).toHaveBeenCalledWith("google:gemini");
    expect(post).toHaveBeenCalledWith(
      "/api/assessment-variant/generate-bank-variants",
      expect.objectContaining({ model: "google:gemini" }),
    );
  });
});

describe("assessmentVariantService.reviewVariantWithAi", () => {
  it("defaults the model and merges apiKeys", async () => {
    buildApiKeysForModel.mockResolvedValue({});
    post.mockResolvedValue({ data: { data: { baselineAssessmentId: 1 } } });

    await assessmentVariantService.reviewVariantWithAi({
      baselineAssessmentId: 1,
      variantAssessmentId: 2,
      courseId: 3,
    });

    expect(post).toHaveBeenCalledWith("/api/assessment-variant/review-variant-ai", {
      baselineAssessmentId: 1,
      variantAssessmentId: 2,
      courseId: 3,
      model: "vllm:qwen2.5-32b-instruct",
      apiKeys: {},
    });
  });
});
