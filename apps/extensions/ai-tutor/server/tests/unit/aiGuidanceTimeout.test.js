/**
 * #999: a single EduAI chat completion round-trip (`callEduAI`, internal to
 * aiGuidance.js) must not hang forever — it's bounded by
 * `EDUAI_CALL_TIMEOUT_MS` and surfaces a user-visible timeout message instead
 * of leaving the student on an unbounded "Thinking..." spinner.
 *
 * `EDUAI_CALL_TIMEOUT_MS` is read once at module load, so the module is
 * re-imported fresh (via `vi.resetModules`) with a tiny timeout stubbed in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    promptTemplate: {
      findUnique: vi.fn().mockResolvedValue({ systemPrompt: 'Be a helpful tutor.' }),
    },
  },
}));

vi.mock('../../src/services/eduaiClient.js', () => ({
  getEduAiCompletionUrl: () => 'http://mock-eduai/api/completion',
}));

const originalTimeout = process.env.EDUAI_CALL_TIMEOUT_MS;
const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetModules();
  process.env.EDUAI_CALL_TIMEOUT_MS = '10';
});

afterEach(() => {
  if (originalTimeout === undefined) delete process.env.EDUAI_CALL_TIMEOUT_MS;
  else process.env.EDUAI_CALL_TIMEOUT_MS = originalTimeout;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('callEduAI timeout (#999)', () => {
  it('surfaces a friendly timeout message when the EduAI call never resolves', async () => {
    // Simulate a hung upstream request: never resolves on its own, only
    // reacts to the AbortSignal firing — same shape as a real stalled fetch.
    global.fetch = vi.fn(
      (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
        }),
    );

    const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

    // The internal `return`-without-`await` chain (supervisedGenerate ->
    // generateWithSupervisor -> generateGuideResponse) means the rejection
    // passes straight through rather than being caught by generateGuideResponse's
    // own try/catch — it's the route handler's `await generateResponse(...)`
    // that ultimately catches it and maps `.status`/`.message` to the HTTP
    // response (see activities.js `handleAiInteraction`). So we assert the
    // rejection shape here rather than a resolved fallback object.
    await expect(
      generateGuideResponse({
        activity: { mainTopic: { name: 'Recursion' }, answer: '42' },
        knowledgeLevel: 'beginner',
        message: 'I am stuck',
        studentAnswer: null,
        dualLoopEnabled: false,
        cookie: 'session=abc',
        apiKey: 'test-key',
      }),
    ).rejects.toMatchObject({
      message: 'The AI study buddy took too long to respond. Please try again.',
      status: 504,
      code: 'TIMEOUT',
    });
  });

  it('does not time out a fast-resolving call', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'Here is a hint.', chatId: 'chat-1' }),
    });

    const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

    const result = await generateGuideResponse({
      activity: { mainTopic: { name: 'Recursion' }, answer: '42' },
      knowledgeLevel: 'beginner',
      message: 'I am stuck',
      studentAnswer: null,
      dualLoopEnabled: false,
      cookie: 'session=abc',
      apiKey: 'test-key',
    });

    expect(result.message).toBe('Here is a hint.');
    expect(result.trace.finalOutcome).toBe('single_pass');
  });
});
