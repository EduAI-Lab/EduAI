import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockGetAiModelPolicyState = vi.fn();
const originalValidationTimeoutMs = process.env.AI_KEY_VALIDATION_TIMEOUT_MS;
const originalMaxTrackedUsers = process.env.AI_KEY_VALIDATION_MAX_TRACKED_USERS;

vi.mock("../../src/services/aiModelPolicy.js", () => ({
  getAiModelPolicyState: (...args) => mockGetAiModelPolicyState(...args),
}));

const { default: aiModelsRoutes, __resetKeyValidationStateForTests } =
  await import("../../src/routes/ai-models.js");

function buildApp({ role, id = "u1" } = {}) {
  const app = express();
  app.use(express.json());
  if (role) {
    app.use((req, _res, next) => {
      req.user = { role, id };
      next();
    });
  }
  app.use("/api", aiModelsRoutes);
  return app;
}

beforeEach(() => {
  mockGetAiModelPolicyState.mockReset();
  __resetKeyValidationStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalValidationTimeoutMs === undefined) {
    delete process.env.AI_KEY_VALIDATION_TIMEOUT_MS;
  } else {
    process.env.AI_KEY_VALIDATION_TIMEOUT_MS = originalValidationTimeoutMs;
  }
  if (originalMaxTrackedUsers === undefined) {
    delete process.env.AI_KEY_VALIDATION_MAX_TRACKED_USERS;
  } else {
    process.env.AI_KEY_VALIDATION_MAX_TRACKED_USERS = originalMaxTrackedUsers;
  }
});

describe("GET /api/ai-models", () => {
  const availableModels = [
    { modelId: "google:gemini-2.5-flash", modelName: "Gemini Flash" },
    { modelId: "openai:o1", modelName: "o1" },
  ];
  const policy = { allowedTutorModelIds: ["google:gemini-2.5-flash"] };

  it("filters models down to the allow-list for STUDENT users", async () => {
    mockGetAiModelPolicyState.mockResolvedValue({
      policy,
      availableModels,
      availableModelsError: null,
    });
    const app = buildApp({ role: "STUDENT", id: "timeout-user" });

    const res = await request(app).get("/api/ai-models");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      modelId: "google:gemini-2.5-flash",
      studentSelectable: true,
      availability: "allowed",
    });
  });

  it("returns every model annotated with availability for non-STUDENT users", async () => {
    mockGetAiModelPolicyState.mockResolvedValue({
      policy,
      availableModels,
      availableModelsError: null,
    });
    const app = buildApp({ role: "INSTRUCTOR" });

    const res = await request(app).get("/api/ai-models");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const flash = res.body.find((m) => m.modelId === "google:gemini-2.5-flash");
    const o1 = res.body.find((m) => m.modelId === "openai:o1");
    expect(flash).toMatchObject({ studentSelectable: true, availability: "allowed" });
    expect(o1).toMatchObject({ studentSelectable: false, availability: "admin-only" });
  });

  it("fails closed to the allow-list-filtered view when req.user is missing", async () => {
    mockGetAiModelPolicyState.mockResolvedValue({
      policy,
      availableModels,
      availableModelsError: null,
    });
    const app = buildApp();

    const res = await request(app).get("/api/ai-models");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ modelId: "google:gemini-2.5-flash" });
  });

  it("fails closed to the allow-list-filtered view for an unrecognized role (e.g. TA)", async () => {
    mockGetAiModelPolicyState.mockResolvedValue({
      policy,
      availableModels,
      availableModelsError: null,
    });
    const app = buildApp({ role: "TA" });

    const res = await request(app).get("/api/ai-models");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ modelId: "google:gemini-2.5-flash" });
  });

  it("returns 500 when the policy state lookup throws", async () => {
    mockGetAiModelPolicyState.mockRejectedValue(new Error("catalog unavailable"));
    const app = buildApp({ role: "ADMIN" });

    const res = await request(app).get("/api/ai-models");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to load AI models");
  });
});

describe("POST /api/ai-models/validate-key", () => {
  it("returns 400 when provider is missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/ai-models/validate-key").send({ apiKey: "x" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ valid: false, error: "Missing provider or apiKey" });
  });

  it("returns 400 when apiKey is missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/ai-models/validate-key").send({ provider: "google" });
    expect(res.status).toBe(400);
  });

  it("returns valid: true for google when the upstream responds ok", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    const app = buildApp();
    const apiKey = "gemini-url-canary-secret";

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "google", apiKey });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain(apiKey);
    expect(options?.headers).toMatchObject({ "x-goog-api-key": apiKey });
  });

  it("returns 200 valid: false for google when the upstream responds 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "bad key" } }),
    });
    const app = buildApp();

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "google", apiKey: "bad" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, error: "bad key" });
  });

  it("falls back to a generic message for google when the error body has no message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    });
    const app = buildApp();

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "google", apiKey: "bad" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, error: "Invalid API key" });
  });

  it("returns valid: true for openai when the upstream responds ok", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    const app = buildApp();

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "openai", apiKey: "k" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer k");
  });

  it("returns 200 valid: false for openai when the upstream responds 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "invalid_api_key" } }),
    });
    const app = buildApp();

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "openai", apiKey: "bad" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, error: "invalid_api_key" });
  });

  it("returns 200 valid: false for an unsupported provider without calling fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const app = buildApp();

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "anthropic", apiKey: "k" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, error: "Unsupported provider" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized API key without forwarding it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const app = buildApp({ role: "STUDENT", id: "oversized-key-user" });

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "google", apiKey: "k".repeat(513) });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ valid: false, error: "Invalid provider or apiKey" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the upstream fetch throws (network failure)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const app = buildApp();

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "google", apiKey: "k" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ valid: false, error: "Validation request failed" });
  });

  it("returns 504 when provider validation exceeds its deadline", async () => {
    process.env.AI_KEY_VALIDATION_TIMEOUT_MS = "5";
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, options = {}) => {
      if (!options.signal) return Promise.reject(new Error("missing validation deadline"));
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        });
      });
    });
    const app = buildApp({ role: "STUDENT", id: "rate-limit-user" });

    const res = await request(app)
      .post("/api/ai-models/validate-key")
      .send({ provider: "google", apiKey: "k" });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ valid: false, error: "Validation request timed out" });
  });

  it("rate limits repeated validation attempts by authenticated user", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({}) });
    const app = buildApp({ role: "STUDENT" });

    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(
        await request(app)
          .post("/api/ai-models/validate-key")
          .send({ provider: "google", apiKey: "k" }),
      );
    }

    expect(responses.slice(0, 10).every((response) => response.status === 200)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(responses[10].body).toEqual({
      valid: false,
      error: "Too many validation attempts",
    });
  });

  it("admits at most two concurrent validations per authenticated user", async () => {
    const providerResolvers = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          providerResolvers.push(resolve);
        }),
    );
    const app = buildApp({ role: "STUDENT", id: "concurrency-user" });
    const body = { provider: "google", apiKey: "k" };

    const first = Promise.resolve(request(app).post("/api/ai-models/validate-key").send(body));
    const second = Promise.resolve(request(app).post("/api/ai-models/validate-key").send(body));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const rejected = await request(app).post("/api/ai-models/validate-key").send(body);
    expect(rejected.status).toBe(429);
    expect(rejected.body).toEqual({ valid: false, error: "Too many validation attempts" });

    for (const resolveProvider of providerResolvers) {
      resolveProvider({ ok: true, json: async () => ({}) });
    }
    const completed = await Promise.all([first, second]);
    expect(completed.map((response) => response.status)).toEqual([200, 200]);
  });

  it("bounds the number of user identities retained by the in-memory limiter", async () => {
    process.env.AI_KEY_VALIDATION_MAX_TRACKED_USERS = "2";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    for (const id of ["bounded-user-1", "bounded-user-2"]) {
      const response = await request(buildApp({ role: "STUDENT", id }))
        .post("/api/ai-models/validate-key")
        .send({ provider: "google", apiKey: "k" });
      expect(response.status).toBe(200);
    }

    const overflow = await request(buildApp({ role: "STUDENT", id: "bounded-user-3" }))
      .post("/api/ai-models/validate-key")
      .send({ provider: "google", apiKey: "k" });

    expect(overflow.status).toBe(503);
    expect(overflow.body).toEqual({ valid: false, error: "Validation service busy" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
