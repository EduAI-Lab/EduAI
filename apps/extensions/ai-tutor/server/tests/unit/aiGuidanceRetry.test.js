/**
 * #1001: transient EduAI failures should receive one bounded retry before the
 * error is surfaced to the student. Fetch is mocked in-process, so these tests
 * never contact the real EduAI endpoint or incur provider charges.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    promptTemplate: {
      findUnique: vi.fn().mockResolvedValue({
        systemPrompt: 'Be a helpful tutor.',
      }),
    },
  },
}));

vi.mock('../../src/services/eduaiClient.js', () => ({
  getEduAiCompletionUrl: () => 'http://not-actually-called.test/api/completion',
}));

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function failedResponse(status, headers = {}, body = `Upstream returned ${status}`) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
  };
}

function successfulResponse() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        content: 'Start by identifying the base case.',
      }),
  };
}

async function generateResponse({ signal } = {}) {
  const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

  return generateGuideResponse({
    activity: {
      mainTopic: { name: 'Recursion' },
      config: {
        question: 'What is a recursive base case?',
        questionType: 'SHORT_TEXT',
      },
    },
    knowledgeLevel: 'beginner',
    message: 'Can you give me a hint?',
    studentAnswer: null,
    dualLoopEnabled: false,
    cookie: 'session=retry-test',
    apiKey: 'fake-test-key',
    signal,
  });
}

describe('callEduAI transient failure retry (#1001)', () => {
  it('resolves Retry-After delays and clamps them to the remaining timeout', async () => {
    const { _testExports } = await import('../../src/services/aiGuidance.js');
    const { resolveRetryDelayMs } = _testExports;
    const retryAt = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');

    expect(resolveRetryDelayMs('2', 5_000, 0)).toBe(2_000);
    expect(resolveRetryDelayMs('Wed, 21 Oct 2015 07:28:00 GMT', 5_000, retryAt - 2_000)).toBe(
      2_000,
    );
    expect(resolveRetryDelayMs(null, 5_000, 0)).toBe(250);
    expect(resolveRetryDelayMs('not-a-delay', 5_000, 0)).toBe(250);
    expect(resolveRetryDelayMs('-3', 5_000, 0)).toBe(0);
    expect(resolveRetryDelayMs('60', 1_000, 0)).toBe(1_000);
  });

  it.each([429, 503])(
    'retries once after a %i response and returns the successful second response',
    async (status) => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(failedResponse(status))
        .mockResolvedValueOnce(successfulResponse());

      const result = await generateResponse();

      expect(result).toMatchObject({
        message: 'Start by identifying the base case.',
        chatId: null,
        trace: {
          finalOutcome: 'single_pass',
        },
      });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps retries stateless when a 503 includes a legacy X-Chat-Id header', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(failedResponse(503, { 'X-Chat-Id': 'legacy-chat-id' }))
      .mockResolvedValueOnce(successfulResponse());

    const result = await generateResponse();
    const firstRequestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const secondRequestBody = JSON.parse(global.fetch.mock.calls[1][1].body);

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://not-actually-called.test/api/completion',
      'http://not-actually-called.test/api/completion',
    ]);
    expect(firstRequestBody).not.toHaveProperty('chatId');
    expect(secondRequestBody).not.toHaveProperty('chatId');
    expect(result.chatId).toBeNull();
  });

  it('retries a generic upstream 429 response once', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(failedResponse(429, {}, JSON.stringify({ error: 'Proxy rate limit' })))
      .mockResolvedValueOnce(successfulResponse());

    const result = await generateResponse();

    expect(result).toMatchObject({
      message: 'Start by identifying the base case.',
      chatId: null,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry Core application rate-limit responses', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        failedResponse(429, {}, JSON.stringify({ error: 'Too Many Requests' })),
      );

    await expect(generateResponse()).rejects.toMatchObject({ status: 429 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('stops after one retry when both attempts return a transient failure', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(failedResponse(503))
      .mockResolvedValueOnce(failedResponse(503));

    await expect(generateResponse()).rejects.toMatchObject({ status: 503 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient HTTP failure', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(failedResponse(400));

    await expect(generateResponse()).rejects.toMatchObject({ status: 400 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not start a retry after the caller cancels during backoff', async () => {
    const controller = new AbortController();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(failedResponse(503))
      .mockResolvedValueOnce(successfulResponse());

    const responsePromise = generateResponse({ signal: controller.signal });
    const rejection = expect(responsePromise).rejects.toMatchObject({ name: 'AbortError' });

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    controller.abort();

    await rejection;
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  describe('Retry-After header integration through the retry loop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses Retry-After delay-seconds header value for the retry backoff', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(failedResponse(503, { 'Retry-After': '0.5' }))
        .mockResolvedValueOnce(successfulResponse());

      const responsePromise = generateResponse();

      await vi.advanceTimersByTimeAsync(0);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(500);
      const result = await responsePromise;

      expect(result).toMatchObject({
        message: 'Start by identifying the base case.',
        chatId: null,
      });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('uses Retry-After HTTP-date header value for the retry backoff', async () => {
      const futureDate = new Date(Date.now() + 2000).toUTCString();

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(failedResponse(503, { 'Retry-After': futureDate }))
        .mockResolvedValueOnce(successfulResponse());

      const responsePromise = generateResponse();

      await vi.advanceTimersByTimeAsync(0);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2000);
      const result = await responsePromise;

      expect(result).toMatchObject({
        message: 'Start by identifying the base case.',
        chatId: null,
      });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

  });
});
