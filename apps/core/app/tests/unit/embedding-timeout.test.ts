import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("ai", () => ({ embed: vi.fn(), embedMany: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn(() => ({})),
  })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

const ENV_KEYS = [
  "EMBEDDING_PROVIDER",
  "EMBEDDING_DIMENSION",
  "EMBEDDING_REQUEST_TIMEOUT_MS",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OLLAMA_BASE_URL",
  "OLLAMA_EMBEDDING_MODEL",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

type EmbeddingModule = typeof import("~/lib/ai/embedding");

function neverSettlingUnlessAborted(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) {
    return Promise.reject(new Error("TEST_MISSING_ABORT_SIGNAL"));
  }

  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" })),
      { once: true },
    );
  });
}

function neverSettlingEvenAfterAbort(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) {
    return Promise.reject(new Error("TEST_MISSING_ABORT_SIGNAL"));
  }
  return new Promise<never>(() => undefined);
}

async function settleWithFakeTimers<T>(promise: Promise<T>) {
  const settled = promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

async function loadCloudEmbeddingModule(): Promise<{
  embedding: EmbeddingModule;
  embedMock: Mock;
  embedManyMock: Mock;
}> {
  process.env.EMBEDDING_PROVIDER = "cloud";
  process.env.EMBEDDING_DIMENSION = "1024";
  process.env.EMBEDDING_REQUEST_TIMEOUT_MS = "100";
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  vi.resetModules();
  const ai = await import("ai");
  const embedding = await import("~/lib/ai/embedding");
  return {
    embedding,
    embedMock: vi.mocked(ai.embed),
    embedManyMock: vi.mocked(ai.embedMany),
  };
}

async function loadLocalEmbeddingModule(): Promise<EmbeddingModule> {
  process.env.EMBEDDING_PROVIDER = "local";
  process.env.EMBEDDING_DIMENSION = "1024";
  process.env.EMBEDDING_REQUEST_TIMEOUT_MS = "100";
  process.env.OLLAMA_BASE_URL = "http://ollama.test/api";
  process.env.OLLAMA_EMBEDDING_MODEL = "mxbai-embed-large";
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  vi.resetModules();
  return import("~/lib/ai/embedding");
}

describe("embedding provider request deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    globalThis.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses a finite default and caps the configured deadline", async () => {
    const { embedding } = await loadCloudEmbeddingModule();

    process.env.EMBEDDING_REQUEST_TIMEOUT_MS = "99";
    expect(embedding.resolveEmbeddingRequestTimeoutMs()).toBe(
      embedding.DEFAULT_EMBEDDING_REQUEST_TIMEOUT_MS,
    );
    process.env.EMBEDDING_REQUEST_TIMEOUT_MS = "2500";
    expect(embedding.resolveEmbeddingRequestTimeoutMs()).toBe(2500);
    process.env.EMBEDDING_REQUEST_TIMEOUT_MS = "999999";
    expect(embedding.resolveEmbeddingRequestTimeoutMs()).toBe(120_000);
  });

  it("aborts and classifies a never-settling cloud embed request after bounded retries", async () => {
    const { embedding, embedMock } = await loadCloudEmbeddingModule();
    const providerSignals: AbortSignal[] = [];
    embedMock.mockImplementation(({ abortSignal }) => {
      if (abortSignal) providerSignals.push(abortSignal);
      return neverSettlingUnlessAborted(abortSignal);
    });

    const result = await settleWithFakeTimers(embedding.generateEmbedding("cloud timeout query"));

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.reason).toMatchObject({
      name: "EmbeddingRequestTimeoutError",
      code: "EMBEDDING_REQUEST_TIMEOUT",
      timeoutMs: 100,
    });
    expect(embedding.classifyRagRetrievalError(result.reason)).toBe("RAG_RETRIEVAL_TIMEOUT");
    expect(embedMock).toHaveBeenCalledTimes(3);
    expect(providerSignals).toHaveLength(3);
    expect(providerSignals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes a fresh bounded signal to every never-settling cloud embedMany attempt", async () => {
    const { embedding, embedManyMock } = await loadCloudEmbeddingModule();
    const providerSignals: AbortSignal[] = [];
    embedManyMock.mockImplementation(({ abortSignal }) => {
      if (abortSignal) providerSignals.push(abortSignal);
      return neverSettlingEvenAfterAbort(abortSignal);
    });

    const result = await settleWithFakeTimers(
      embedding.generateEmbeddings(["cloud timeout chunk"]),
    );

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.reason).toMatchObject({
      name: "EmbeddingRequestTimeoutError",
      code: "EMBEDDING_REQUEST_TIMEOUT",
    });
    expect(embedManyMock).toHaveBeenCalledTimes(3);
    expect(new Set(providerSignals).size).toBe(3);
    expect(providerSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("aborts and classifies a never-settling native Ollama fetch", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      neverSettlingUnlessAborted(init?.signal ?? undefined),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const embedding = await loadLocalEmbeddingModule();

    const result = await settleWithFakeTimers(embedding.generateEmbedding("local timeout query"));

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.reason).toMatchObject({ name: "Error" });
    expect(String((result.reason as Error).message)).toContain("Local embedding provider failed");
    expect(embedding.classifyRagRetrievalError(result.reason)).toBe("RAG_RETRIEVAL_TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const signals = fetchMock.mock.calls.map((call) => call[1]?.signal);
    expect(signals.every((signal) => signal instanceof AbortSignal && signal.aborted)).toBe(true);
  });

  it("preserves caller cancellation through the native Ollama path", async () => {
    const providerSignals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      if (signal) providerSignals.push(signal);
      return neverSettlingUnlessAborted(signal);
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const embedding = await loadLocalEmbeddingModule();
    const caller = new AbortController();
    const cancellation = new Error("job lease lost");

    const outcome = embedding
      .generateEmbedding("cancelled local query", undefined, {
        signal: caller.signal,
      })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
    await vi.advanceTimersByTimeAsync(0);
    caller.abort(cancellation);
    await vi.runAllTimersAsync();

    expect(await outcome).toEqual({ status: "rejected", reason: cancellation });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(providerSignals).toHaveLength(1);
    expect(providerSignals[0].aborted).toBe(true);
    expect(providerSignals[0].reason).toBe(cancellation);
  });

  it("composes caller cancellation with the deadline and does not retry cancellation", async () => {
    const { embedding, embedMock } = await loadCloudEmbeddingModule();
    const providerSignals: AbortSignal[] = [];
    embedMock.mockImplementation(({ abortSignal }) => {
      if (abortSignal) providerSignals.push(abortSignal);
      return neverSettlingUnlessAborted(abortSignal);
    });
    const caller = new AbortController();
    const cancellation = new Error("request disconnected");

    const pending = embedding.generateEmbedding("cancelled query", undefined, {
      signal: caller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    caller.abort(cancellation);
    const result = await settleWithFakeTimers(pending);

    expect(result).toEqual({ status: "rejected", reason: cancellation });
    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(providerSignals).toHaveLength(1);
    expect(providerSignals[0]).not.toBe(caller.signal);
    expect(providerSignals[0].aborted).toBe(true);
    expect(providerSignals[0].reason).toBe(cancellation);
    expect(embedding.classifyRagRetrievalError(cancellation)).toBe("RAG_RETRIEVAL_FAILED");
    expect(vi.getTimerCount()).toBe(0);
  });
});
