/**
 * Unit tests for the EduAIService singleton (src/services/eduaiService.js).
 *
 * axios is fully mocked so no network is touched; config is mocked so the singleton constructs
 * as "configured". The class is not exported, so the unconfigured branches are exercised by
 * temporarily blanking the instance's apiKey and restoring it afterward.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

vi.mock("../../src/config/settings.js", () => ({
  config: {
    eduaiApiUrl: "http://eduai.test",
    eduaiApiKey: "test-key-123456",
    eduaiIgnoredCourseCodes: [],
  },
}));

const axios = (await import("axios")).default;
const { config } = await import("../../src/config/settings.js");
const eduaiService = (await import("../../src/services/eduaiService.js")).default;

/** Builds an axios-style error carrying a server response. */
function responseError({ status = 500, statusText = "Internal Server Error", data = {} } = {}) {
  return Object.assign(new Error("Request failed"), {
    response: { status, statusText, data, headers: {} },
    config: { url: "http://eduai.test/api/completion" },
  });
}

/** Builds an axios-style error where the request was sent but no response came back. */
function requestError({ code, message = "no response" } = {}) {
  return Object.assign(new Error(message), {
    request: {},
    code,
    config: {
      url: "http://eduai.test/api/completion",
      baseURL: "http://eduai.test",
      timeout: 60000,
    },
  });
}

function capturedConsoleOutput() {
  return ['log', 'warn', 'error']
    .flatMap((method) => console[method].mock.calls)
    .flatMap((call) => call)
    .map((value) => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  config.eduaiIgnoredCourseCodes = [];
  config.eduaiProbeCourseId = '';
  config.eduaiProbeCourseCode = '';
  eduaiService.apiKey = 'test-key-123456';
  eduaiService.baseURL = 'http://eduai.test';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isConfigured", () => {
  it("is true when an API key is present", () => {
    expect(eduaiService.isConfigured()).toBe(true);
  });

  it("is true when base URL is set even if the API key is blank", () => {
    eduaiService.apiKey = "";
    expect(eduaiService.isConfigured()).toBe(true);
  });

  it("is false when the base URL is blank", () => {
    eduaiService.baseURL = "";
    expect(eduaiService.isConfigured()).toBe(false);
  });
});

describe('chat', () => {
  it('never logs completion content returned by Core', async () => {
    const contentCanary = 'AUDIT_MODEL_CONTENT_CANARY_7f45a2';
    axios.post.mockResolvedValue({ status: 200, data: { content: contentCanary } });

    await eduaiService.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(capturedConsoleOutput()).not.toContain(contentCanary);
  });

  it('does not expose response bodies, headers, or stable-error canaries', async () => {
    const bodyCanary = 'AUDIT_RESPONSE_BODY_CANARY_b19c0e';
    const authCanary = 'AUDIT_RESPONSE_AUTH_CANARY_82e711';
    const cookieCanary = 'AUDIT_RESPONSE_COOKIE_CANARY_13ec50';
    const correlationId = 'core-request-7d1ec9';
    axios.post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        response: {
          status: 502,
          statusText: `Bad Gateway ${bodyCanary}`,
          data: { error: bodyCanary, prompt: `student-${bodyCanary}` },
          headers: {
            authorization: `Bearer ${authCanary}`,
            'set-cookie': `session=${cookieCanary}`,
            'x-request-id': correlationId,
          },
        },
      }),
    );

    const thrown = await eduaiService.chat({ messages: [] }).catch((error) => error);
    const output = `${capturedConsoleOutput()}\n${thrown.message}`;

    expect(output).not.toContain(bodyCanary);
    expect(output).not.toContain(authCanary);
    expect(output).not.toContain(cookieCanary);
    expect(capturedConsoleOutput()).toContain(correlationId);
    const failureLog = console.error.mock.calls.find(
      ([event]) => event === '[EduAI] completion response failed',
    );
    expect(failureLog?.[1]).toMatchObject({
      status: 502,
      correlationId,
      elapsedMs: expect.any(Number),
    });
    expect(Object.keys(failureLog?.[1] ?? {}).sort()).toEqual([
      'correlationId',
      'elapsedMs',
      'status',
    ]);
  });

  it('does not serialize raw Axios request/config data or transport messages', async () => {
    const requestCanary = 'AUDIT_RAW_REQUEST_CANARY_d89444';
    const configCanary = 'AUDIT_CONFIG_SECRET_CANARY_cba290';
    const cookieCanary = 'AUDIT_REQUEST_COOKIE_CANARY_2057fb';
    axios.post.mockRejectedValue(
      Object.assign(new Error(`connect failed ${requestCanary}`), {
        code: 'ECONNREFUSED',
        request: {
          rawHeaders: ['Authorization', `Bearer ${requestCanary}`],
          config: {
            headers: { cookie: `session=${cookieCanary}` },
            data: { systemPrompt: configCanary },
          },
        },
        config: {
          url: 'http://eduai.test/api/completion',
          method: 'post',
          timeout: 60000,
          headers: { authorization: `Bearer ${configCanary}` },
          data: { messages: [{ content: requestCanary }] },
        },
      }),
    );

    const thrown = await eduaiService.chat({ messages: [] }).catch((error) => error);
    const output = `${capturedConsoleOutput()}\n${thrown.message}`;

    expect(output).not.toContain(requestCanary);
    expect(output).not.toContain(configCanary);
    expect(output).not.toContain(cookieCanary);
    const failureLog = console.error.mock.calls.find(
      ([event]) => event === '[EduAI] completion request failed',
    );
    expect(failureLog?.[1]).toMatchObject({
      code: 'ECONNREFUSED',
      elapsedMs: expect.any(Number),
      timeoutMs: 60000,
    });
    expect(Object.keys(failureLog?.[1] ?? {}).sort()).toEqual([
      'code',
      'elapsedMs',
      'timeoutMs',
    ]);
  });

  it('throws when neither a session cookie nor a service key is available', async () => {
    eduaiService.apiKey = '';
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/not configured/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("posts to /api/completion and returns the response body", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: "hello" } });

    const out = await eduaiService.chat({
      messages: [
        { role: "system", content: "You generate questions." },
        { role: "user", content: "hi" },
      ],
      courseCode: "CS 101",
      courseId: "cuid-core-cs101",
      cookie: "__Secure-better-auth.session_token=abc",
    });

    expect(out).toEqual({ content: "hello" });
    const [url, payload, opts] = axios.post.mock.calls[0];
    expect(url).toBe("http://eduai.test/api/completion");
    expect(payload.systemPrompt).toBe("You generate questions.");
    expect(payload.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(payload.courseCode).toBe("CS 101");
    expect(payload.courseId).toBe("cuid-core-cs101");
    // Core's requireServiceKey guard expects Authorization: Bearer (not x-api-key).
    expect(opts.headers["Authorization"]).toBe("Bearer test-key-123456");
    expect(opts.headers.cookie).toBeUndefined();
    expect(opts.headers["x-api-key"]).toBeUndefined();
    expect(opts.timeout).toBe(60000);
  });

  it('passes the shared deadline signal into Axios and aborts the in-flight call', async () => {
    vi.useFakeTimers();
    let capturedOptions;
    axios.post.mockImplementation((_url, _payload, options) => {
      capturedOptions = options;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', request: {} }));
        }, { once: true });
      });
    });

    const deadlineAt = Date.now() + 90_000;
    const pending = eduaiService.chat({
      messages: [{ role: 'user', content: 'wait' }],
      timeoutMs: 120_000,
      deadlineAt,
    });
    const rejection = expect(pending).rejects.toMatchObject({
      statusCode: 504,
      code: 'QM_AI_OPERATION_DEADLINE',
    });

    await vi.advanceTimersByTimeAsync(89_999);
    expect(capturedOptions.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(capturedOptions.signal.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('omits courseId from the payload when it is not provided', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: 'ok' } });
    await eduaiService.chat({ messages: [], courseCode: 'BIO 101' });
    const payload = axios.post.mock.calls[0][1];
    expect(payload.courseCode).toBe("BIO 101");
    expect(payload).not.toHaveProperty("courseId");
  });

  it("posts user messages and elevates system role into top-level systemPrompt", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: "hello" } });

    await eduaiService.chat({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "hi" },
      ],
      courseCode: "CS 101",
      cookie: "__Secure-better-auth.session_token=abc",
    });

    const [, payload, opts] = axios.post.mock.calls[0];
    expect(payload.systemPrompt).toBe("Return JSON only");
    expect(payload.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(payload.streaming).toBe(false);
    expect(payload.routingContext).toEqual({
      feature: "question-maker",
      jobType: "background",
    });
    // Service key is preferred when configured (cookie is only the fallback).
    expect(opts.headers.Authorization).toBe("Bearer test-key-123456");
    expect(opts.headers.cookie).toBeUndefined();
  });

  it("falls back to Bearer service key when no cookie is present", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: "hello" } });

    await eduaiService.chat({
      messages: [{ role: "user", content: "hi" }],
      courseCode: "CS 101",
    });

    const [, , opts] = axios.post.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer test-key-123456");
    expect(opts.headers.cookie).toBeUndefined();
  });

  it("honors an explicit timeoutMs override", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { message: "ok" } });
    await eduaiService.chat({ messages: [], timeoutMs: 5000 });
    expect(axios.post.mock.calls[0][2].timeout).toBe(5000);
  });

  it('translates a server error response without relaying its body', async () => {
    axios.post.mockRejectedValue(responseError({ status: 502, data: { error: 'upstream down' } }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/^EduAI API error \(502\)$/);
  });

  it("reports a timeout when the request aborts (ECONNABORTED)", async () => {
    axios.post.mockRejectedValue(
      requestError({ code: "ECONNABORTED", message: "timeout of 60000ms exceeded" }),
    );
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/timed out/i);
  });

  it("reports an unreachable server (ECONNREFUSED)", async () => {
    axios.post.mockRejectedValue(requestError({ code: "ECONNREFUSED" }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/unreachable/i);
  });

  it("reports a reset connection (ECONNRESET)", async () => {
    axios.post.mockRejectedValue(requestError({ code: "ECONNRESET" }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/connection was reset/i);
  });

  it("reports a generic coded request failure", async () => {
    axios.post.mockRejectedValue(requestError({ code: "EPIPE" }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/EPIPE/);
  });

  it('wraps an error with neither response nor request', async () => {
    axios.post.mockRejectedValue(new Error('boom'));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/^EduAI API error$/);
  });
});

describe("generateQuestions", () => {
  const baseParams = { prompt: "cells", courseCode: "BIO 101" };

  it('enforces prompt and count budgets at the service boundary', async () => {
    const oversizedPrompt = 'x'.repeat(12_001);

    await expect(eduaiService.generateQuestions({
      ...baseParams,
      prompt: oversizedPrompt,
    })).rejects.toMatchObject({ status: 413, code: 'QM_PROMPT_TOO_LARGE' });

    await expect(eduaiService.generateQuestions({
      ...baseParams,
      numQuestions: 51,
    })).rejects.toMatchObject({ status: 400, code: 'QM_QUESTION_COUNT_TOO_LARGE' });

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not start a JSON repair call after an upstream 429', async () => {
    axios.post.mockRejectedValueOnce(responseError({
      status: 429,
      data: { error: 'provider body api_key=must-not-leak' },
    }));

    await expect(eduaiService.generateQuestions(baseParams)).rejects.toMatchObject({ statusCode: 429 });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('never logs malformed model content during the JSON repair path', async () => {
    const firstCanary = 'AUDIT_GENERATION_PREVIEW_CANARY_640eaf';
    const repairCanary = 'AUDIT_REPAIR_PREVIEW_CANARY_4a05c1';
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { content: firstCanary } })
      .mockResolvedValueOnce({ status: 200, data: { content: repairCanary } });

    await expect(eduaiService.generateQuestions(baseParams)).rejects.toThrow();

    expect(capturedConsoleOutput()).not.toContain(firstCanary);
    expect(capturedConsoleOutput()).not.toContain(repairCanary);
  });

  it('throws when prompt is missing, or both courseCode and courseId are missing', async () => {
    await expect(eduaiService.generateQuestions({ prompt: 'x' })).rejects.toThrow(/required/i);
    await expect(eduaiService.generateQuestions({ courseCode: 'BIO 101' })).rejects.toThrow(/required/i);
  });

  it('accepts courseId without courseCode', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [{ content: 'Q?', description: 'd', difficulty: 'easy', reasoning_level: 'factual', type: 'SA', answer: 'a' }],
      },
    });
    const out = await eduaiService.generateQuestions({ prompt: 'cells', courseId: 'cuid-core' });
    expect(out).toHaveLength(1);
    expect(axios.post.mock.calls[0][1].courseId).toBe('cuid-core');
    expect(axios.post.mock.calls[0][1]).not.toHaveProperty('courseCode');
    expect(axios.post.mock.calls[0][2].timeout).toBeGreaterThan(0);
  });

  it('normalizes a plain array of SA questions', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: "Q?",
            description: "d",
            difficulty: "easy",
            reasoning_level: "factual",
            type: "SA",
            answer: "a",
          },
        ],
      },
    });
    const out = await eduaiService.generateQuestions({ prompt: "cells", courseId: "cuid-core" });
    expect(out).toHaveLength(1);
    expect(axios.post.mock.calls[0][1].courseId).toBe("cuid-core");
    expect(axios.post.mock.calls[0][1]).not.toHaveProperty("courseCode");
  });

  it("normalizes a plain array of SA questions", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: "  What is a cell?  ",
            description: "Defn",
            difficulty: "easy",
            reasoning_level: "factual",
            type: "SA",
            answer: " the basic unit ",
          },
        ],
      },
    });

    const out = await eduaiService.generateQuestions(baseParams);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("What is a cell?");
    expect(out[0].type).toBe("SA");
    expect(out[0].answer).toBe("the basic unit");
    expect(out[0].choices).toBeNull();
  });

  it('caps normalized provider output at the requested question count', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: Array.from({ length: 5 }, (_, index) => ({
          content: `Question ${index + 1}`,
          description: 'd',
          difficulty: 'easy',
          reasoning_level: 'factual',
          type: 'SA',
          answer: 'a',
        })),
      },
    });

    const out = await eduaiService.generateQuestions({ ...baseParams, numQuestions: 2 });

    expect(out).toHaveLength(2);
    expect(out.map((question) => question.content)).toEqual(['Question 1', 'Question 2']);
  });

  it('parses a JSON string response and defaults bad difficulty/reasoning', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: JSON.stringify([
          {
            content: "Q?",
            type: "LA",
            difficulty: "spicy",
            reasoning_level: "vibes",
            answer: "A long answer",
          },
        ]),
      },
    });

    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].difficulty).toBe("medium");
    expect(out[0].reasoning_level).toBe("factual");
    expect(out[0].type).toBe("LA");
  });

  it("extracts a JSON array embedded in surrounding prose", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content:
          'Sure! Here you go: [{"content":"Q?","type":"SA","difficulty":"hard","reasoning_level":"analytical","answer":"yes"}] done',
      },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].difficulty).toBe("hard");
  });

  it("ignores CUID-like markdown citations instead of throwing SyntaxError", async () => {
    // Old greedy /(\[[\s\S]*\])/ matched [mr68fk2hgh…] and JSON.parse threw
    // "Unexpected token 'm'". Valid question array still follows in the prose.
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content:
          "Based on context [mr68fk2hghxyz] here is the item:\n" +
          '[{"content":"What is binary?","type":"SA","difficulty":"easy","reasoning_level":"factual","answer":"base 2"}]',
      },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("What is binary?");
  });

  it("retries with a JSON-only repair when the first reply is prose only", async () => {
    axios.post
      .mockResolvedValueOnce({
        status: 200,
        data: {
          content:
            "Based on the provided context, here is a multiple-choice question about rockets...",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          content: JSON.stringify([
            {
              content: "What fuels a rocket?",
              type: "SA",
              difficulty: "easy",
              reasoning_level: "factual",
              answer: "propellant",
            },
          ]),
        },
      });

    const out = await eduaiService.generateQuestions(baseParams);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("What fuels a rocket?");
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it("unwraps a { questions: [...] } envelope", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: {
          questions: [
            {
              content: "Q?",
              type: "SA",
              difficulty: "easy",
              reasoning_level: "factual",
              answer: "a",
            },
          ],
        },
      },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out).toHaveLength(1);
  });

  it('does not relay a model-reported reason from an error object', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: { error: true, reason: 'topic not covered' } } });
    await expect(eduaiService.generateQuestions(baseParams)).rejects.toThrow(/^EduAI question generation failed$/);
  });

  it("throws when the parsed response is not a question array", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: { foo: "bar" } } });
    await expect(eduaiService.generateQuestions(baseParams)).rejects.toThrow(/generation failed/i);
  });

  it("throws when no valid questions survive normalization", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { content: [{ description: "no content field" }] },
    });
    await expect(eduaiService.generateQuestions(baseParams)).rejects.toThrow(/generation failed/i);
  });

  it("normalizes MCQ choices given as an object map and reduces the answer to a letter", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: "Pick one",
            type: "MCQ",
            difficulty: "easy",
            reasoning_level: "factual",
            choices: { A: "first", B: "second" },
            answer: "B) second",
          },
        ],
      },
    });

    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].type).toBe("MCQ");
    expect(out[0].choices).toEqual([
      { letter: "A", text: "first" },
      { letter: "B", text: "second" },
    ]);
    expect(out[0].answer).toBe("B");
  });

  it("parses MCQ choices embedded in the content body", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: "What color?\nA) Red\nB) Blue",
            type: "MCQ",
            difficulty: "easy",
            reasoning_level: "factual",
            answer: "A",
          },
        ],
      },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].content).toBe("What color?");
    expect(out[0].choices).toEqual([
      { letter: "A", text: "Red" },
      { letter: "B", text: "Blue" },
    ]);
  });

  it("falls back to placeholder choices for an MCQ with none (unenforced count)", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: "No choices here",
            type: "MCQ",
            difficulty: "easy",
            reasoning_level: "factual",
            answer: "A",
          },
        ],
      },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].choices).toHaveLength(4);
  });

  it("leaves choices empty for an MCQ with none when an exact count is enforced", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: "No choices",
            type: "MCQ",
            difficulty: "easy",
            reasoning_level: "factual",
            answer: "A",
          },
        ],
      },
    });
    const out = await eduaiService.generateQuestions({ ...baseParams, mcqRequiredChoiceCount: 4 });
    expect(out[0].choices).toEqual([]);
  });

  it("dedupes secondary topic ids and drops the primary from them", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: "Q?",
            type: "SA",
            difficulty: "easy",
            reasoning_level: "factual",
            answer: "a",
            primary_topic_id: 5,
            secondary_topic_ids: [5, 6, 6, 7],
          },
        ],
      },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].primary_topic_id).toBe(5);
    expect(out[0].secondary_topic_ids).toEqual([6, 7]);
  });

  it("honors system/user prompt overrides via Core systemPrompt field", async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: "Q?",
            type: "SA",
            difficulty: "easy",
            reasoning_level: "factual",
            answer: "a",
          },
        ],
      },
    });
    await eduaiService.generateQuestions({
      ...baseParams,
      systemPromptOverride: "sys",
      userPromptOverride: "usr",
    });
    const payload = axios.post.mock.calls[0][1];
    expect(payload.systemPrompt).toBe("sys");
    expect(payload.messages).toEqual([{ role: "user", content: "usr" }]);
  });
});

describe('listCourses', () => {
  it.each([
    ['courses', () => eduaiService.listCourses()],
    ['topics', () => eduaiService.getCourseTopics(42)],
    ['models', () => eduaiService.listAIModels()],
  ])('does not log the raw Axios request for %s failures', async (_name, invoke) => {
    const requestCanary = 'AUDIT_CATALOG_REQUEST_CANARY_384b37';
    const cookieCanary = 'AUDIT_CATALOG_COOKIE_CANARY_a4c861';
    axios.get.mockRejectedValue(
      Object.assign(new Error(`network ${requestCanary}`), {
        code: 'ECONNRESET',
        request: {
          rawHeaders: ['cookie', cookieCanary],
          body: { prompt: requestCanary },
        },
        config: {
          headers: { authorization: `Bearer ${requestCanary}` },
        },
      }),
    );

    await invoke().catch(() => {});

    expect(capturedConsoleOutput()).not.toContain(requestCanary);
    expect(capturedConsoleOutput()).not.toContain(cookieCanary);
  });

  it('throws when not configured', async () => {
    eduaiService.apiKey = '';
    await expect(eduaiService.listCourses()).rejects.toThrow(/not configured/i);
  });

  // #1041: Core answers `{ data, total, page, pageSize }` and the service
  // unwraps it to a plain course array.
  const coursePage = (courses) => ({
    data: { data: courses, total: courses.length, page: 1, pageSize: 200 },
  });

  it("returns the courses unchanged when no codes are ignored", async () => {
    axios.get.mockResolvedValue(coursePage([{ id: 1, code: "CS 101" }]));
    const out = await eduaiService.listCourses();
    expect(out).toEqual([{ id: 1, code: "CS 101" }]);
  });

  it("requests a bounded page rather than the whole catalog", async () => {
    axios.get.mockResolvedValue(coursePage([]));
    await eduaiService.listCourses();
    expect(axios.get.mock.calls[0][0]).toMatch(/\/api\/courses\?page=1&pageSize=200$/);
  });

  it("filters ignored codes out of the page", async () => {
    config.eduaiIgnoredCourseCodes = ["CS101"];
    axios.get.mockResolvedValue(
      coursePage([
        { id: 1, code: "CS 101" },
        { id: 2, code: "BIO 200" },
      ]),
    );
    const out = await eduaiService.listCourses();
    expect(out).toEqual([{ id: 2, code: "BIO 200" }]);
  });

  it('translates a server error response without relaying its body', async () => {
    axios.get.mockRejectedValue(responseError({ status: 404, data: { message: 'nope' } }));
    await expect(eduaiService.listCourses()).rejects.toThrow(/^EduAI API error \(404\)$/);
  });

  it('reports a no-response failure', async () => {
    axios.get.mockRejectedValue(requestError({ code: 'ETIMEDOUT' }));
    await expect(eduaiService.listCourses()).rejects.toThrow(/timed out/i);
  });

  it('wraps a setup error', async () => {
    axios.get.mockRejectedValue(new Error('weird'));
    await expect(eduaiService.listCourses()).rejects.toThrow(/^EduAI API error$/);
  });
});

describe("getCourseTopics", () => {
  it("throws when not configured", async () => {
    eduaiService.apiKey = "";
    await expect(eduaiService.getCourseTopics(1)).rejects.toThrow(/not configured/i);
  });

  it("throws when courseId is missing", async () => {
    await expect(eduaiService.getCourseTopics()).rejects.toThrow(/courseId is required/);
  });

  it("returns topic data on success", async () => {
    axios.get.mockResolvedValue({ data: [{ id: 9, name: "Topic" }] });
    const out = await eduaiService.getCourseTopics(42);
    expect(out).toEqual([{ id: 9, name: "Topic" }]);
    expect(axios.get.mock.calls[0][0]).toBe("http://eduai.test/api/courses/42/topics");
  });

  it("translates a server error response", async () => {
    axios.get.mockRejectedValue(responseError({ status: 500, statusText: "ISE", data: {} }));
    await expect(eduaiService.getCourseTopics(42)).rejects.toThrow(/EduAI API error \(500\)/);
  });

  it('reports a no-response failure', async () => {
    axios.get.mockRejectedValue(requestError({ code: 'ECONNRESET' }));
    await expect(eduaiService.getCourseTopics(42)).rejects.toThrow(/connection was reset/i);
  });
});

describe("listAIModels", () => {
  it("throws when not configured", async () => {
    eduaiService.apiKey = "";
    await expect(eduaiService.listAIModels()).rejects.toThrow(/not configured/i);
  });

  it("returns the model page data on success", async () => {
    // #1041: `/api/ai-models` answers with the paginated envelope.
    axios.get.mockResolvedValue({
      data: { data: ["a", "b"], total: 2, page: 1, pageSize: 200 },
    });
    const out = await eduaiService.listAIModels();
    expect(out).toEqual(["a", "b"]);
  });

  it('translates a server error response without relaying its body', async () => {
    axios.get.mockRejectedValue(responseError({ status: 503, data: { error: 'busy' } }));
    await expect(eduaiService.listAIModels()).rejects.toThrow(/^EduAI API error \(503\)$/);
  });

  it('wraps a setup error', async () => {
    axios.get.mockRejectedValue(new Error('odd'));
    await expect(eduaiService.listAIModels()).rejects.toThrow(/^EduAI API error$/);
  });
});

describe("testApiKey", () => {
  it("returns failure when neither cookie nor service key is available", async () => {
    eduaiService.apiKey = "";
    const out = await eduaiService.testApiKey();
    expect(out).toEqual({
      success: false,
      error: "Sign in via Core to use AI (session cookie required)",
    });
  });

  it("returns success when the chat call works via service key", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: "pong" } });
    const out = await eduaiService.testApiKey();
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/Service key can reach AI/i);
    expect(axios.post.mock.calls[0][2].headers.Authorization).toBe("Bearer test-key-123456");
    // No hardcoded seed course — service-key probes are course-free by default.
    expect(axios.post.mock.calls[0][1].courseCode).toBeUndefined();
    expect(axios.post.mock.calls[0][1].courseId).toBeUndefined();
  });

  it("never sends courseId/courseCode even when legacy probe-course config is set (#1109)", async () => {
    config.eduaiProbeCourseId = "cuid-legacy";
    config.eduaiProbeCourseCode = "COSC 121";
    axios.post.mockResolvedValue({ status: 200, data: { content: "pong" } });
    const out = await eduaiService.testApiKey({
      cookie: "__Secure-better-auth.session_token=abc",
    });
    expect(out.success).toBe(true);
    expect(axios.post.mock.calls[0][1].courseId).toBeUndefined();
    expect(axios.post.mock.calls[0][1].courseCode).toBeUndefined();
  });

  it("prefers the service key when both cookie and service key are present", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: "pong" } });
    const out = await eduaiService.testApiKey({
      cookie: "__Secure-better-auth.session_token=abc",
    });
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/Service key can reach AI/i);
    expect(axios.post.mock.calls[0][2].headers.Authorization).toBe("Bearer test-key-123456");
    expect(axios.post.mock.calls[0][2].headers.cookie).toBeUndefined();
  });

  it("flags auth failure on a 401", async () => {
    axios.post.mockRejectedValue(
      responseError({ status: 401, statusText: "Unauthorized", data: {} }),
    );
    const out = await eduaiService.testApiKey();
    expect(out).toEqual({
      success: false,
      error: "AI authentication failed — sign in via Core again",
    });
  });

  it("flags forbidden access on a 403", async () => {
    axios.post.mockRejectedValue(responseError({ status: 403, statusText: "Forbidden", data: {} }));
    const out = await eduaiService.testApiKey();
    expect(out).toEqual({ success: false, error: "AI access forbidden for this session" });
  });

  it("treats a provider-key failure as a valid EduAI key", async () => {
    axios.post.mockRejectedValue(
      responseError({ status: 400, data: { error: "Invalid API key for provider" } }),
    );
    const out = await eduaiService.testApiKey();
    expect(out.success).toBe(true);
    expect(out.note).toMatch(/provider API keys/i);
  });

  it("returns a generic failure for other errors", async () => {
    axios.post.mockRejectedValue(responseError({ status: 500, statusText: "ISE", data: {} }));
    const out = await eduaiService.testApiKey();
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/API key test failed/);
  });

  it("reports the cloud path for any supported provider key, not just Google", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: "pong" } });
    for (const provider of ["openai", "deepseek", "anthropic"]) {
      const out = await eduaiService.testApiKey({
        apiKeys: { [provider]: { apiKey: "sk-test", isEnabled: true } },
      });
      expect(out.success).toBe(true);
      expect(out.provider).toBe(provider);
    }
  });

  it('selects OpenCode and forwards its dedicated catalog model and key', async () => {
    const out = await eduaiService.testApiKey({
      apiKeys: { opencode: { apiKey: 'opencode-secret', isEnabled: true } },
    });
    expect(out.provider).toBe('opencode');
    const [, body] = axios.post.mock.calls.at(-1);
    expect(body.model).toBe('opencode:deepseek-v4-flash');
    expect(body.apiKeys.opencode).toEqual({ apiKey: 'opencode-secret', isEnabled: true });
  });
});

describe("getConnectivityTestParams", () => {
  const savedConfigKey = config.googleGenerativeAiApiKey;
  afterEach(() => {
    config.googleGenerativeAiApiKey = savedConfigKey;
  });

  it("prefers a client cloud key over the UBC-hosted path", () => {
    const params = eduaiService.getConnectivityTestParams({
      openai: { apiKey: "sk-openai", isEnabled: true },
    });
    expect(params.provider).toBe("openai");
    expect(params.model).toBe("openai:gpt-4o-mini");
    expect(params.apiKeys.openai.apiKey).toBe("sk-openai");
  });

  it("picks Google first when multiple client keys are present", () => {
    const params = eduaiService.getConnectivityTestParams({
      anthropic: { apiKey: "sk-ant", isEnabled: true },
      google: { apiKey: "g-key", isEnabled: true },
    });
    expect(params.provider).toBe("google");
  });

  it("falls back to the server Google key when no client key is present", () => {
    config.googleGenerativeAiApiKey = "server-google";
    const params = eduaiService.getConnectivityTestParams({});
    expect(params.provider).toBe("google");
    expect(params.apiKeys.google.apiKey).toBe("server-google");
  });

  it("falls back to the UBC-hosted path when no cloud key exists at all", () => {
    config.googleGenerativeAiApiKey = undefined;
    const params = eduaiService.getConnectivityTestParams({});
    expect(params.provider).toBe("vllm");
    expect(params.model).toBe("vllm:qwen2.5-7b-instruct");
  });

  it('forceProvider "ollama" uses the smallest campus model from the live catalog', () => {
    config.googleGenerativeAiApiKey = "server-google";
    const catalog = [
      { provider: "vllm", modelId: "qwen2.5-32b-instruct", name: "32B", isActive: true },
      { provider: "vllm", modelId: "qwen2.5-7b-instruct", name: "7B", isActive: true },
    ];
    const params = eduaiService.getConnectivityTestParams({}, "ollama", catalog);
    expect(params.provider).toBe("vllm");
    expect(params.model).toBe("vllm:qwen2.5-7b-instruct");
    expect(params.apiKeys.vllm.isEnabled).toBe(true);
    expect(params.apiKeys.google).toBeUndefined();
  });

  it('forceProvider "vllm" pins the UBC path even when a client cloud key is present', () => {
    const catalog = [
      { provider: { name: "vllm" }, modelId: "custom-campus-3b", name: "3B", isActive: true },
    ];
    const params = eduaiService.getConnectivityTestParams(
      { openai: { apiKey: "sk-openai", isEnabled: true } },
      "vllm",
      catalog,
    );
    expect(params.provider).toBe("vllm");
    expect(params.model).toBe("vllm:custom-campus-3b");
  });
});

describe("testApiKey forceProvider", () => {
  const savedConfigKey = config.googleGenerativeAiApiKey;
  afterEach(() => {
    config.googleGenerativeAiApiKey = savedConfigKey;
  });

  it("probes the UBC path (vllm) when forced, ignoring the server Google key", async () => {
    config.googleGenerativeAiApiKey = "server-google";
    axios.get.mockResolvedValue({
      status: 200,
      data: [
        { provider: "vllm", modelId: "qwen2.5-32b-instruct", name: "32B", isActive: true },
        { provider: "vllm", modelId: "qwen2.5-7b-instruct", name: "7B", isActive: true },
      ],
    });
    axios.post.mockResolvedValue({ status: 200, data: { content: "pong" } });
    const out = await eduaiService.testApiKey({ apiKeys: {}, forceProvider: "vllm" });
    expect(out.success).toBe(true);
    expect(out.provider).toBe("vllm");
    const [, body, opts] = axios.post.mock.calls.at(-1);
    expect(body.model).toBe("vllm:qwen2.5-7b-instruct");
    expect(body.apiKeys.vllm.isEnabled).toBe(true);
    expect(body.apiKeys.google).toBeUndefined();
    expect(opts.timeout).toBe(20000);
  });
});
