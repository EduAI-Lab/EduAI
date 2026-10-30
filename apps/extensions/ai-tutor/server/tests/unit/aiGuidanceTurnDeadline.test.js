/**
 * #2028: one study buddy turn (every tutor + supervisor call) is bounded by
 * `EDUAI_TURN_TIMEOUT_MS`, kept under the client's 60s timeout. Both env
 * timeouts are read at module load, so the module is re-imported per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    promptTemplate: {
      findUnique: vi.fn(({ where }) =>
        Promise.resolve({
          systemPrompt: where.slug === "supervisor-prompt" ? "SUPERVISOR" : "TUTOR",
        }),
      ),
    },
  },
}));

vi.mock("../../src/services/eduaiClient.js", () => ({
  getEduAiCompletionUrl: () => "http://mock-eduai/api/completion",
}));

const FALLBACK_MESSAGE =
  "I'm having trouble formulating a helpful response right now. Please try rephrasing your question, or ask your instructor for guidance.";
const TIMEOUT_MESSAGE = "The AI study buddy took too long to respond. Please try again.";

const originalCallTimeout = process.env.EDUAI_CALL_TIMEOUT_MS;
const originalTurnTimeout = process.env.EDUAI_TURN_TIMEOUT_MS;
const originalFetch = global.fetch;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // The per-call limit is far above the turn deadline, so only the turn
  // deadline can end these calls in time.
  process.env.EDUAI_CALL_TIMEOUT_MS = "10000";
  process.env.EDUAI_TURN_TIMEOUT_MS = "150";
});

afterEach(() => {
  restoreEnv("EDUAI_CALL_TIMEOUT_MS", originalCallTimeout);
  restoreEnv("EDUAI_TURN_TIMEOUT_MS", originalTurnTimeout);
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function reply(content) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ content, chatId: "chat-1" }),
  });
}

function hang(opts) {
  return new Promise((_resolve, reject) => {
    opts.signal.addEventListener("abort", () => reject(opts.signal.reason));
  });
}

/** Routes each mocked EduAI call to the tutor or supervisor handler by prompt. */
function mockModels({ tutor, supervisor }) {
  const calls = { tutor: 0, supervisor: 0 };
  global.fetch = vi.fn((_url, opts) => {
    const { systemPrompt } = JSON.parse(opts.body);
    if (systemPrompt === "SUPERVISOR") {
      calls.supervisor += 1;
      return supervisor(calls.supervisor, opts);
    }
    calls.tutor += 1;
    return tutor(calls.tutor, opts);
  });
  return calls;
}

async function runGuideTurn() {
  const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");
  return generateGuideResponse({
    activity: { mainTopic: { name: "Recursion" }, config: { question: "What is 2+2?" } },
    knowledgeLevel: "beginner",
    message: "I am stuck",
    studentAnswer: null,
    tutorModelId: "google:gemini-2.5-flash",
    supervisorModelId: "google:gemini-2.5-flash",
    dualLoopEnabled: true,
    maxSupervisorIterations: 3,
    cookie: "session=abc",
    apiKey: "test-key",
  });
}

describe("study buddy turn deadline (#2028)", () => {
  it("returns the safe fallback when the deadline hits a revision after a reviewed draft", async () => {
    const calls = mockModels({
      tutor: (n, opts) => (n === 1 ? reply("Draft that reveals 4") : hang(opts)),
      supervisor: () => reply('{"approved": false}'),
    });

    const startedAt = Date.now();
    const result = await runGuideTurn();

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(calls).toEqual({ tutor: 2, supervisor: 1 });
    // The rejected draft is never surfaced.
    expect(result.message).toBe(FALLBACK_MESSAGE);
    expect(result.trace).toMatchObject({
      finalOutcome: "safe_fallback",
      finalResponse: FALLBACK_MESSAGE,
      iterationCount: 1,
      turnDeadlineReached: true,
    });
  });

  it("returns the safe fallback when the deadline hits a later supervisor review", async () => {
    mockModels({
      tutor: (n) => reply(`Draft ${n}`),
      supervisor: (n, opts) => (n === 1 ? reply('{"approved": false}') : hang(opts)),
    });

    const result = await runGuideTurn();

    expect(result.message).toBe(FALLBACK_MESSAGE);
    expect(result.trace).toMatchObject({
      finalOutcome: "safe_fallback",
      iterationCount: 1,
      turnDeadlineReached: true,
    });
  });

  it("rejects with a 504 when the deadline hits before any draft was reviewed", async () => {
    mockModels({
      tutor: (_n, opts) => hang(opts),
      supervisor: () => reply('{"approved": true}'),
    });

    const startedAt = Date.now();
    await expect(runGuideTurn()).rejects.toMatchObject({
      message: TIMEOUT_MESSAGE,
      status: 504,
      code: "TIMEOUT",
    });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("maps a first-review supervisor timeout to a 504 for the route", async () => {
    mockModels({
      tutor: () => reply("Draft 1"),
      supervisor: (_n, opts) => hang(opts),
    });

    const { getSafeAiErrorMetadata } = await import("../../src/services/aiGuidance.js");
    const error = await runGuideTurn().catch((e) => e);

    // The route reads status/code through the supervisor error's cause.
    expect(getSafeAiErrorMetadata(error)).toMatchObject({ status: 504, code: "TIMEOUT" });
  });

  it("leaves a fast approved turn unchanged", async () => {
    const calls = mockModels({
      tutor: () => reply("Think about counting."),
      supervisor: () => reply('{"approved": true}'),
    });

    const result = await runGuideTurn();

    expect(calls).toEqual({ tutor: 1, supervisor: 1 });
    expect(result.message).toBe("Think about counting.");
    expect(result.trace.finalOutcome).toBe("approved");
    expect(result.trace).not.toHaveProperty("turnDeadlineReached");
  });

  it("still returns the exhaustion fallback without the deadline flag", async () => {
    process.env.EDUAI_TURN_TIMEOUT_MS = "10000";
    const calls = mockModels({
      tutor: (n) => reply(`Draft ${n}`),
      supervisor: () => reply('{"approved": false}'),
    });

    const result = await runGuideTurn();

    expect(calls).toEqual({ tutor: 3, supervisor: 3 });
    expect(result.trace).toMatchObject({ finalOutcome: "safe_fallback", iterationCount: 3 });
    expect(result.trace).not.toHaveProperty("turnDeadlineReached");
  });
});
