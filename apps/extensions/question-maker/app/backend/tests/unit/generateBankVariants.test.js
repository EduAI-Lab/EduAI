/**
 * Unit tests for generateBankVariantsForQuestions orchestration.
 *
 * The AI boundary (eduaiService) is mocked — these tests verify the orchestration contract:
 * - validation guards before any AI call is made
 * - the primary variant of each question is promoted to non-draft before generation
 * - MCQ choice-count retry fires when the model returns the wrong count
 * - errors are recorded per-question, not thrown, so other questions still process
 * - isAiGenerated=true and isDraft=true are set on all generated variants (drafts pending review)
 * - referenceId is set to the primary variant's id
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---- hoisted mocks ---------------------------------------------------------
const {
  mockIsConfigured,
  mockGenerateQuestions,
  mockCourseFindOne,
  mockTopicsFindAll,
  mockMetaFindMany,
  mockVariantCreate,
  mockVariantUpdateMany,
  mockVariantFindMany,
} = vi.hoisted(() => ({
  mockIsConfigured: vi.fn().mockReturnValue(true),
  mockGenerateQuestions: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockTopicsFindAll: vi.fn().mockResolvedValue([]),
  // The service prefetches every requested question in one batched read, so the
  // mock resolves an array of the metadata rows visible for that course. Defaults
  // to an empty batch so a test that forgets to prime it takes the not-found path.
  mockMetaFindMany: vi.fn().mockResolvedValue([]),
  mockVariantCreate: vi.fn(),
  mockVariantUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  // Existing variant texts per question, read once for the batch so generation can
  // reject a model reply that repeats one (#1763). Defaults to an empty bank.
  mockVariantFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/services/eduaiService.js", () => ({
  default: {
    isConfigured: mockIsConfigured,
    generateQuestions: mockGenerateQuestions,
  },
}));

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    port: 8000,
    nodeEnv: "test",
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    coreUrl: "http://core.test",
    extensionUrl: "http://localhost:8000",
    encryptionKey: "test-encryption-key-32bytes!!!!!",
    corsOrigins: ["*"],
    groqApiKey: "",
    openaiApiKey: "",
    deepseekApiKey: "",
    eduaiApiUrl: "https://eduai.ok.ubc.ca",
    eduaiApiKey: "test-service-key",
    eduaiIgnoredCourseCodes: [],
    defaultNumQuestions: 15,
    maxQuestions: 50,
    rateLimitWindowMs: 900000,
    rateLimitMax: 1000,
    logLevel: "silent",
  };
  return { config: cfg, default: cfg };
});

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findFirst: mockCourseFindOne },
    topics: { findMany: mockTopicsFindAll },
    questionMetadata: { findMany: mockMetaFindMany },
    variants: {
      create: mockVariantCreate,
      updateMany: mockVariantUpdateMany,
      findMany: mockVariantFindMany,
    },
  },
}));

const { generateBankVariantsForQuestions } =
  await import("../../src/services/assessmentVariantService.js");

// ---------------------------------------------------------------------------

const USER_ID = "cuid-user-1";
const COURSE = { id: 1, code: "CS 101", name: "Intro to CS" };
const BASE_PARAMS = { courseId: 1, questionIds: [10], variantsToAdd: 1 };

function makeMeta({ id = 10, type = "SA", variants = [] } = {}) {
  return { id, type, courseId: 1, variants };
}

function makePrimaryVariant(overrides = {}) {
  return {
    id: 100,
    questionText: "What is recursion?",
    difficulty: "medium",
    reasoningLevel: "factual",
    choices: null,
    secondaryTopicsId: [],
    ...overrides,
  };
}

function makeGeneratedQuestion(overrides = {}) {
  return [
    {
      content: "New variant text",
      difficulty: "medium",
      reasoning_level: "factual",
      answer: null,
      choices: null,
      ...overrides,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockTopicsFindAll.mockResolvedValue([]);
  mockMetaFindMany.mockResolvedValue([]);
  mockVariantCreate.mockResolvedValue({ id: 200 });
  mockVariantUpdateMany.mockResolvedValue({ count: 1 });
  mockVariantFindMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------

describe("generateBankVariantsForQuestions — validation guards", () => {
  it("throws when courseId is missing", async () => {
    await expect(generateBankVariantsForQuestions(USER_ID, { questionIds: [10] })).rejects.toThrow(
      /courseId.*required|required/i,
    );
  });

  it("throws when questionIds is empty", async () => {
    await expect(
      generateBankVariantsForQuestions(USER_ID, { courseId: 1, questionIds: [] }),
    ).rejects.toThrow(/required/i);
  });

  it("throws when questionIds is not an array", async () => {
    await expect(
      generateBankVariantsForQuestions(USER_ID, { courseId: 1, questionIds: 10 }),
    ).rejects.toThrow(/required/i);
  });

  it("throws when the course is not found", async () => {
    mockCourseFindOne.mockResolvedValueOnce(null);
    await expect(generateBankVariantsForQuestions(USER_ID, BASE_PARAMS)).rejects.toThrow(
      /course not found/i,
    );
  });

  it("throws when eduaiService is not configured", async () => {
    mockIsConfigured.mockReturnValueOnce(false);
    await expect(generateBankVariantsForQuestions(USER_ID, BASE_PARAMS)).rejects.toThrow(
      /not configured/i,
    );
  });
});

// ---------------------------------------------------------------------------

describe("generateBankVariantsForQuestions — per-question orchestration", () => {
  it("stops bank fanout immediately after an upstream 429", async () => {
    const rateLimited = new Error("upstream body must stay private");
    rateLimited.statusCode = 429;
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockGenerateQuestions.mockRejectedValueOnce(rateLimited);

    await expect(
      generateBankVariantsForQuestions(USER_ID, {
        courseId: 1,
        questionIds: [10, 20],
        variantsToAdd: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(1);
    expect(mockMetaFindMany).toHaveBeenCalledTimes(1);
  });

  it("records an error (does not throw) when a question is not found in the DB", async () => {
    mockMetaFindMany.mockResolvedValueOnce([]);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors).toHaveLength(1);
    expect(errors[0].questionId).toBe(10);
    expect(errors[0].error).toMatch(/not found|no variants/i);
  });

  it("records an error when a question has no variants in the DB", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [] })]);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors).toHaveLength(1);
    expect(errors[0].questionId).toBe(10);
  });

  it("promotes the first (primary) variant to isDraft=false before calling AI", async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockVariantUpdateMany).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { isDraft: false },
    });
  });

  it("records a per-question error when the primary variant was deleted mid-batch", async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    // The prefetched snapshot went stale — the row is gone, so updateMany matches nothing.
    mockVariantUpdateMany.mockResolvedValueOnce({ count: 0 });

    const { results, errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockGenerateQuestions).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].questionId).toBe(10);
    // Reported distinctly from the "id not visible for this course" miss, so a caller
    // reading the response can tell a stale snapshot apart from a bad id.
    expect(errors[0].error).toMatch(/removed during generation/i);
  });

  it("calls generateQuestions once per variantsToAdd iteration", async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    // Distinct texts: identical replies are a duplicate now and cost a retry call (#1763).
    mockGenerateQuestions
      .mockResolvedValueOnce(makeGeneratedQuestion({ content: "First variant" }))
      .mockResolvedValueOnce(makeGeneratedQuestion({ content: "Second variant" }));

    await generateBankVariantsForQuestions(USER_ID, {
      courseId: 1,
      questionIds: [10],
      variantsToAdd: 2,
    });

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(2);
  });

  it("creates a variant with isAiGenerated=true and isDraft=true (draft pending review)", async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isAiGenerated: true, isDraft: true }),
    });
  });

  it("returns full createdVariants payloads for in-place review", async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    const { results } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(results[0].createdVariants).toEqual([
      expect.objectContaining({ id: 200, questionMetadataId: 10, isDraft: true }),
    ]);
  });

  it("sets referenceId to the primary variant id on the created variant", async () => {
    const primary = makePrimaryVariant({ id: 777 });
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ referenceId: 777 }),
    });
  });

  it("continues processing remaining questions after one fails — does not abort the batch", async () => {
    // qid 10 → not found (error); qid 20 → found (result)
    // One batched read for both ids: 10 is absent from the result (not found or not
    // visible for this course), 20 comes back.
    mockMetaFindMany.mockResolvedValueOnce([
      makeMeta({ id: 20, variants: [makePrimaryVariant()] }),
    ]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    const { results, errors } = await generateBankVariantsForQuestions(USER_ID, {
      courseId: 1,
      questionIds: [10, 20],
      variantsToAdd: 1,
    });

    // The failed question lands in errors; the successful one lands in results
    expect(errors).toHaveLength(1);
    expect(errors[0].questionId).toBe(10);

    // Only the successfully processed question produces a result entry
    expect(results).toHaveLength(1);
    expect(results[0].questionId).toBe(20);
  });

  it.each([
    [
      "provider",
      () =>
        mockGenerateQuestions.mockRejectedValueOnce(
          new Error("SECRET_PROVIDER_BODY?api_key=canary"),
        ),
    ],
    [
      "database",
      () => {
        mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());
        mockVariantCreate.mockRejectedValueOnce(new Error("SECRET_DB_URL"));
      },
    ],
  ])("redacts unexpected %s failures from results and logs", async (_source, arrangeFailure) => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    arrangeFailure();

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors).toEqual([
      expect.objectContaining({
        questionId: 10,
        iteration: 1,
        error: "Variant generation failed",
      }),
    ]);
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain("SECRET_PROVIDER_BODY");
    expect(logged).not.toContain("api_key");
    expect(logged).not.toContain("SECRET_DB_URL");
    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe("generateBankVariantsForQuestions — MCQ choice-count retry", () => {
  it("triggers a retry call when the model returns the wrong number of MCQ choices", async () => {
    const choices = [
      { letter: "A", text: "First" },
      { letter: "B", text: "Second" },
      { letter: "C", text: "Third" },
    ];
    const primary = makePrimaryVariant({
      choices,
      difficulty: "easy",
      reasoningLevel: "factual",
    });
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ type: "MCQ", variants: [primary] })]);

    // First call returns only 1 choice (wrong count) → retry
    mockGenerateQuestions
      .mockResolvedValueOnce([
        {
          content: "MCQ wrong count",
          difficulty: "easy",
          reasoning_level: "factual",
          answer: "A",
          choices: [{ letter: "A", text: "Only one" }],
        },
      ])
      .mockResolvedValueOnce([
        {
          content: "MCQ correct count",
          difficulty: "easy",
          reasoning_level: "factual",
          answer: "A",
          choices,
        },
      ]);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(0);
  });

  it("records an error when the retry still returns the wrong MCQ choice count", async () => {
    const choices = [
      { letter: "A", text: "One" },
      { letter: "B", text: "Two" },
      { letter: "C", text: "Three" },
    ];
    const primary = makePrimaryVariant({ choices });
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ type: "MCQ", variants: [primary] })]);

    const wrongCount = [
      {
        content: "X",
        difficulty: "medium",
        reasoning_level: "factual",
        answer: "A",
        choices: [{ letter: "A", text: "Only" }],
      },
    ];
    mockGenerateQuestions.mockResolvedValue(wrongCount);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].questionId).toBe(10);
  });

  it("records an error (not a throw) when the AI returns no content", async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce([{ content: null }]);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/no question content/i);
  });
});

// ---------------------------------------------------------------------------

describe("generateBankVariantsForQuestions — duplicate blocking (#1763)", () => {
  /** A bank row as the existing-variant prefetch returns it. */
  const existing = (questionMetadataId, questionText) => ({ questionMetadataId, questionText });

  it("retries once when the model repeats a variant the question already has", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockVariantFindMany.mockResolvedValueOnce([existing(10, "New variant text")]);
    mockGenerateQuestions
      .mockResolvedValueOnce(makeGeneratedQuestion())
      .mockResolvedValueOnce(makeGeneratedQuestion({ content: "A genuinely different variant" }));

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(2);
    expect(mockVariantCreate).toHaveBeenCalledTimes(1);
    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ questionText: "A genuinely different variant" }),
    });
    expect(errors).toHaveLength(0);
  });

  it("tells the retry that its last reply duplicated an existing variant", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockVariantFindMany.mockResolvedValueOnce([existing(10, "New variant text")]);
    mockGenerateQuestions
      .mockResolvedValueOnce(makeGeneratedQuestion())
      .mockResolvedValueOnce(makeGeneratedQuestion({ content: "Different enough" }));

    await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    const retryPrompt = mockGenerateQuestions.mock.calls[1][0].prompt;
    expect(retryPrompt).toMatch(/duplicate|already has/i);
  });

  it("ignores whitespace and case when deciding a reply is a duplicate", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockVariantFindMany.mockResolvedValueOnce([existing(10, "New   VARIANT\ntext")]);
    mockGenerateQuestions
      .mockResolvedValueOnce(makeGeneratedQuestion())
      .mockResolvedValueOnce(makeGeneratedQuestion({ content: "Different enough" }));

    await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(2);
  });

  it("reports a duplicate without inserting when the retry duplicates as well", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockVariantFindMany.mockResolvedValueOnce([existing(10, "New variant text")]);
    mockGenerateQuestions.mockResolvedValue(makeGeneratedQuestion());

    const { results, errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(2);
    expect(mockVariantCreate).not.toHaveBeenCalled();
    expect(results[0].createdVariantIds).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ questionId: 10, code: "VARIANT_DUPLICATE" });
    expect(errors[0].error).toMatch(/duplicate/i);
  });

  it("blocks a later iteration that repeats the variant just created in this run", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockVariantFindMany.mockResolvedValueOnce([]);
    mockGenerateQuestions
      .mockResolvedValueOnce(makeGeneratedQuestion({ content: "First new variant" }))
      .mockResolvedValueOnce(makeGeneratedQuestion({ content: "First new variant" }))
      .mockResolvedValueOnce(makeGeneratedQuestion({ content: "Second new variant" }));

    const { errors } = await generateBankVariantsForQuestions(USER_ID, {
      courseId: 1,
      questionIds: [10],
      variantsToAdd: 2,
    });

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(3);
    expect(mockVariantCreate).toHaveBeenCalledTimes(2);
    expect(mockVariantCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ questionText: "Second new variant" }),
    });
    expect(errors).toHaveLength(0);
  });

  it("only compares against variants of the same question", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    // Another question in the batch owns this text; it must not block question 10.
    mockVariantFindMany.mockResolvedValueOnce([existing(20, "New variant text")]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(1);
    expect(mockVariantCreate).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("generateBankVariantsForQuestions — failure causes (#1763)", () => {
  /** A failure shaped like the one eduaiService re-wraps after classifying it. */
  const generationError = (fields) =>
    Object.assign(new Error("EduAI question generation failed"), {
      name: "EduAIQuestionGenerationError",
      ...fields,
    });

  it("names an unreachable provider instead of reporting a generic failure", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockGenerateQuestions.mockRejectedValueOnce(generationError({ transportCode: "ECONNREFUSED" }));

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ questionId: 10, code: "PROVIDER_UNREACHABLE" });
    expect(errors[0].error).toMatch(/reach/i);
  });

  it("names a rejected API key", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockGenerateQuestions.mockRejectedValueOnce(
      generationError({ reasonCode: "PROVIDER_API_KEY_REQUIRED", statusCode: 401 }),
    );

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors[0]).toMatchObject({ code: "PROVIDER_AUTH" });
    expect(errors[0].error).toMatch(/API key/i);
  });

  it("names an unparseable model reply", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockGenerateQuestions.mockRejectedValueOnce(
      generationError({ reasonCode: "PROVIDER_MALFORMED_JSON" }),
    );

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors[0]).toMatchObject({ code: "PROVIDER_MALFORMED_JSON" });
  });

  it("keeps the existing wording for a missing-content failure", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockGenerateQuestions.mockResolvedValueOnce([{ content: null }]);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors[0]).toMatchObject({
      code: "VARIANT_GENERATION_FAILED",
      error: "EduAI returned no question content",
    });
  });

  it("never leaks an unclassifiable provider message", async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [makePrimaryVariant()] })]);
    mockGenerateQuestions.mockRejectedValueOnce(new Error("key sk-live-SECRET123 was rejected"));

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors[0].error).toBe("Variant generation failed");
    expect(errors[0].code).toBe("VARIANT_GENERATION_FAILED");
  });
});
