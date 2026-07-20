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
  getEduAiChatUrl: () => 'http://not-actually-called.test/api/chat',
}));

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function failedResponse(status) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(`Upstream returned ${status}`),
  };
}

function successfulResponse() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        content: 'Start by identifying the base case.',
        chatId: 'chat-after-retry',
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
        chatId: 'chat-after-retry',
        trace: {
          finalOutcome: 'single_pass',
        },
      });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    },
  );

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
});
