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

describe('callEduAI transient failure retry (#1001)', () => {
  it('retries once after a 503 response and returns the successful second response', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service temporarily unavailable'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'Start by identifying the base case.',
            chatId: 'chat-after-retry',
          }),
      });

    const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

    const result = await generateGuideResponse({
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
    });

    expect(result).toMatchObject({
      message: 'Start by identifying the base case.',
      chatId: 'chat-after-retry',
      trace: {
        finalOutcome: 'single_pass',
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
