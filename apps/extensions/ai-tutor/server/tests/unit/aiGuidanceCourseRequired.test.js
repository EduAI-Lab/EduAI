/**
 * #1021: Core interactive chat requires a resolvable course (#657 COURSE_REQUIRED).
 * AI Tutor must forward Core's course CUID (`course.coreOfferingId` → body.courseId)
 * on EduAI chat calls, not only a courseCode that may fail exact lookup.
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

const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('getCoreCourseId wiring helper (#1021)', () => {
  it('returns trimmed coreOfferingId when the offering is linked', async () => {
    const { getCoreCourseId } = await import('../../src/utils/coreCourseId.js');
    expect(getCoreCourseId({ coreOfferingId: '  cuid-core-cosc121  ' })).toBe('cuid-core-cosc121');
  });

  it('returns null for missing, blank, or non-string coreOfferingId', async () => {
    const { getCoreCourseId } = await import('../../src/utils/coreCourseId.js');
    expect(getCoreCourseId({})).toBeNull();
    expect(getCoreCourseId({ coreOfferingId: null })).toBeNull();
    expect(getCoreCourseId({ coreOfferingId: '   ' })).toBeNull();
    expect(getCoreCourseId({ coreOfferingId: 42 })).toBeNull();
  });

  it('exposes trimNonEmpty for shared callEduAI / wiring trim', async () => {
    const { trimNonEmpty } = await import('../../src/utils/coreCourseId.js');
    expect(trimNonEmpty('  abc  ')).toBe('abc');
    expect(trimNonEmpty('   ')).toBeNull();
    expect(trimNonEmpty(null)).toBeNull();
  });
});

describe('callEduAI courseId pass-through (#1021)', () => {
  it('includes courseId and courseCode on the EduAI chat body when linked', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'Here is a hint.', chatId: 'chat-1' }),
    });

    const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

    await generateGuideResponse({
      activity: { mainTopic: { name: 'Recursion' }, answer: '42' },
      knowledgeLevel: 'beginner',
      message: 'I am stuck',
      studentAnswer: null,
      dualLoopEnabled: false,
      cookie: 'session=abc',
      apiKey: 'test-key',
      courseCode: 'COSC 121',
      courseId: 'cuid-core-cosc121',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.courseId).toBe('cuid-core-cosc121');
    expect(body.courseCode).toBe('COSC 121');
  });

  it('omits courseId from the payload when the offering is unlinked', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'Here is a hint.', chatId: 'chat-1' }),
    });

    const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

    await generateGuideResponse({
      activity: { mainTopic: { name: 'Recursion' }, answer: '42' },
      knowledgeLevel: 'beginner',
      message: 'I am stuck',
      studentAnswer: null,
      dualLoopEnabled: false,
      cookie: 'session=abc',
      apiKey: 'test-key',
      courseCode: 'COSC 121',
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('courseId');
    expect(body.courseCode).toBe('COSC 121');
  });

  it('forwards courseId on supervisor EduAI calls in dual-loop mode', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: JSON.stringify({
            approved: true,
            reason: 'ok',
            feedbackToTutor: '',
            safeResponseToStudent: '',
          }),
          chatId: 'chat-1',
        }),
    });

    // First call = tutor draft (plain text); second = supervisor (JSON).
    // Override after the module loads so we can branch on call count.
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ content: 'Tutor draft hint.', chatId: 'chat-1' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          content: JSON.stringify({
            approved: true,
            reason: 'ok',
            feedbackToTutor: '',
            safeResponseToStudent: '',
          }),
          chatId: 'chat-1',
        }),
      };
    });

    const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

    await generateGuideResponse({
      activity: { mainTopic: { name: 'Recursion' }, answer: '42' },
      knowledgeLevel: 'beginner',
      message: 'I am stuck',
      studentAnswer: null,
      dualLoopEnabled: true,
      maxSupervisorIterations: 1,
      cookie: 'session=abc',
      apiKey: 'test-key',
      courseCode: 'COSC 121',
      courseId: 'cuid-core-cosc121',
      supervisorModelId: 'google:gemini-2.5-flash',
    });

    expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [, opts] of global.fetch.mock.calls) {
      const body = JSON.parse(opts.body);
      expect(body.courseId).toBe('cuid-core-cosc121');
      expect(body.courseCode).toBe('COSC 121');
    }
  });

  it('trims whitespace-padded courseId/courseCode before sending', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'Here is a hint.', chatId: 'chat-1' }),
    });

    const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

    await generateGuideResponse({
      activity: { mainTopic: { name: 'Recursion' }, answer: '42' },
      knowledgeLevel: 'beginner',
      message: 'I am stuck',
      studentAnswer: null,
      dualLoopEnabled: false,
      cookie: 'session=abc',
      apiKey: 'test-key',
      courseCode: '  COSC 121  ',
      courseId: '  cuid-core-cosc121  ',
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.courseId).toBe('cuid-core-cosc121');
    expect(body.courseCode).toBe('COSC 121');
  });

  it('omits whitespace-only courseId from the payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: 'Here is a hint.', chatId: 'chat-1' }),
    });

    const { generateGuideResponse } = await import('../../src/services/aiGuidance.js');

    await generateGuideResponse({
      activity: { mainTopic: { name: 'Recursion' }, answer: '42' },
      knowledgeLevel: 'beginner',
      message: 'I am stuck',
      studentAnswer: null,
      dualLoopEnabled: false,
      cookie: 'session=abc',
      apiKey: 'test-key',
      courseCode: 'COSC 121',
      courseId: '   ',
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('courseId');
    expect(body.courseCode).toBe('COSC 121');
  });
});
