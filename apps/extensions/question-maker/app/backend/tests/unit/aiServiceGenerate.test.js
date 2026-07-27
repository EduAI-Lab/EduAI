/**
 * Unit tests for aiService's exported functions with all network/DB collaborators mocked:
 *   - generateQuestions: provider routing (Groq/OpenAI/DeepSeek), parsing, and fallbacks
 *   - extractQuestionsFromText: EduAI extraction, retry-on-empty, topic prompting, MCQ handling
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

const generateQuestionsMock = vi.fn();
const isConfiguredMock = vi.fn(() => true);
vi.mock('../../src/services/eduaiService.js', () => ({
  default: { isConfigured: isConfiguredMock, generateQuestions: generateQuestionsMock },
}));

const findByPk = vi.fn();
const findAll = vi.fn();
const enrichCourseDetail = vi.fn();
vi.mock('../../src/config/database.js', () => ({
  prisma: {
    questionMetadata: {},
    course: { findUnique: findByPk },
    topics: { findMany: findAll },
  },
}));

vi.mock('../../src/services/courseListService.js', () => ({
  enrichCourseDetail,
}));

const axios = (await import('axios')).default;
const { extractQuestionsFromText, generateQuestions, AI_PROVIDERS } = await import('../../src/services/aiService.js');

/** axios chat-completion shape shared by Groq/OpenAI/DeepSeek. */
function completion(content) {
  return { data: { choices: [{ message: { content } }] } };
}

const genParams = { numQuestions: 3, difficultyDistribution: { easy: 1, medium: 1, hard: 1 } };
const validQ = JSON.stringify([
  { content: 'Q1', difficulty: 'easy', bloom_level: 'remember' },
  { content: 'Q2', difficulty: 'hard', bloom_level: 'analyze' },
]);

beforeEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
  findByPk.mockResolvedValue({ id: 7, coreCourseId: null });
  enrichCourseDetail.mockImplementation(async (course) => {
    const row = course?.toJSON ? course.toJSON() : course;
    return {
      ...row,
      code: null,
      name: 'Unavailable (Core offline)',
      coreUnavailable: true,
    };
  });
  findAll.mockResolvedValue([]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateQuestions (provider routing)', () => {
  it('routes to Groq and returns validated questions', async () => {
    axios.post.mockResolvedValue(completion(validQ));
    const out = await generateQuestions('topic', AI_PROVIDERS.GROQ, genParams);
    expect(out).toHaveLength(2);
    expect(axios.post.mock.calls[0][0]).toContain('groq.com');
  });

  it('routes to OpenAI', async () => {
    axios.post.mockResolvedValue(completion(validQ));
    await generateQuestions('topic', AI_PROVIDERS.OPENAI, genParams);
    expect(axios.post.mock.calls[0][0]).toContain('openai.com');
  });

  it('routes to DeepSeek', async () => {
    axios.post.mockResolvedValue(completion(validQ));
    await generateQuestions('topic', AI_PROVIDERS.DEEPSEEK, genParams);
    expect(axios.post.mock.calls[0][0]).toContain('deepseek.com');
  });

  it('throws on an unsupported provider', async () => {
    await expect(generateQuestions('topic', 'gpt5', genParams)).rejects.toThrow(/Unsupported AI provider/);
  });

  it('drops questions failing validation and keeps the valid ones', async () => {
    axios.post.mockResolvedValue(completion(JSON.stringify([
      { content: 'good', difficulty: 'easy', bloom_level: 'remember' },
      { content: 'bad-diff', difficulty: 'trivial', bloom_level: 'remember' },
      { content: 'bad-bloom', difficulty: 'easy', bloom_level: 'guessing' },
    ])));
    const out = await generateQuestions('t', AI_PROVIDERS.GROQ, genParams);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('good');
  });

  it('falls back to a single raw question when the response is not JSON', async () => {
    axios.post.mockResolvedValue(completion('not json at all'));
    const out = await generateQuestions('t', AI_PROVIDERS.GROQ, genParams);
    expect(out).toEqual([{ content: 'not json at all', difficulty: 'medium', bloom_level: 'understand' }]);
  });

  it('falls back when JSON parses but has no valid questions', async () => {
    axios.post.mockResolvedValue(completion(JSON.stringify([{ content: 'x', difficulty: 'nope', bloom_level: 'nope' }])));
    const out = await generateQuestions('t', AI_PROVIDERS.GROQ, genParams);
    expect(out).toHaveLength(1);
    expect(out[0].bloom_level).toBe('understand');
  });

  it('propagates a provider HTTP error', async () => {
    axios.post.mockRejectedValue(new Error('429 rate limited'));
    await expect(generateQuestions('t', AI_PROVIDERS.GROQ, genParams)).rejects.toThrow(/Groq API error: 429 rate limited/);
  });
});

describe('extractQuestionsFromText (EduAI extraction)', () => {
  it('throws when EduAI is not configured', async () => {
    isConfiguredMock.mockReturnValue(false);
    await expect(extractQuestionsFromText('Some exam text here.', 7, 'm', {})).rejects.toThrow(/not configured/i);
  });

  it('sanitizes EduAI output and derives a summary from content when description is missing', async () => {
    generateQuestionsMock.mockResolvedValue([
      { content: '  What is the time complexity of binary search on a sorted array of n items?  ', difficulty: 'medium', type: 'SA', answer: 'O(log n)' },
    ]);
    const out = await extractQuestionsFromText('A real exam question about algorithms.', 7, 'm', {});
    expect(out).toHaveLength(1);
    expect(out[0].question).toBe('What is the time complexity of binary search on a sorted array of n items?');
    expect(out[0].type).toBe('SA');
    expect(out[0].answer).toBe('O(log n)');
    // 12+ words → summary is truncated with an ellipsis
    expect(out[0].summary.endsWith('…')).toBe(true);
  });

  it('preserves MCQ choices through sanitization', async () => {
    generateQuestionsMock.mockResolvedValue([
      {
        content: 'Pick the prime',
        description: 'primes',
        difficulty: 'easy',
        type: 'MCQ',
        answer: 'B',
        choices: [{ letter: 'a', text: '4' }, { letter: 'b', text: '7' }],
      },
    ]);
    const out = await extractQuestionsFromText('exam text', 7, 'm', {});
    expect(out[0].type).toBe('MCQ');
    expect(out[0].choices).toEqual([{ letter: 'A', text: '4' }, { letter: 'B', text: '7' }]);
  });

  it('retries with a simplified prompt when the first pass sanitizes to nothing', async () => {
    generateQuestionsMock
      .mockResolvedValueOnce([{ description: 'no content' }]) // sanitizes to []
      .mockResolvedValueOnce([{ content: 'Recovered Q', difficulty: 'easy', type: 'SA', answer: null }]);
    const out = await extractQuestionsFromText('exam text', 7, 'm', {});
    expect(generateQuestionsMock).toHaveBeenCalledTimes(2);
    expect(out[0].question).toBe('Recovered Q');
  });

  it('throws when both the initial pass and retry produce nothing', async () => {
    generateQuestionsMock.mockResolvedValue([{ description: 'never any content' }]);
    await expect(extractQuestionsFromText('exam text', 7, 'm', {})).rejects.toThrow();
    expect(generateQuestionsMock).toHaveBeenCalledTimes(2);
  });

  it('includes course topics in the prompt when topics exist', async () => {
    findAll.mockResolvedValue([{ id: 11, name: 'Recursion' }]);
    generateQuestionsMock.mockResolvedValue([{ content: 'Q', difficulty: 'easy', type: 'SA', answer: null }]);
    await extractQuestionsFromText('exam text', 7, 'm', {});
    const callArg = generateQuestionsMock.mock.calls[0][0];
    expect(callArg.userPromptOverride).toContain('Course topics');
    expect(callArg.userPromptOverride).toContain('ID 11: Recursion');
  });

  it('continues without topics when the topic fetch fails', async () => {
    findAll.mockRejectedValue(new Error('db down'));
    generateQuestionsMock.mockResolvedValue([{ content: 'Q', difficulty: 'easy', type: 'SA', answer: null }]);
    const out = await extractQuestionsFromText('exam text', 7, 'm', {});
    expect(out).toHaveLength(1);
  });

  it('synthesizes a course code when the course row is missing', async () => {
    findByPk.mockResolvedValue(null);
    generateQuestionsMock.mockResolvedValue([{ content: 'Q', difficulty: 'easy', type: 'SA', answer: null }]);
    await extractQuestionsFromText('exam text', 99, 'm', {});
    expect(generateQuestionsMock.mock.calls[0][0].courseCode).toBe('COURSE-UNKNOWN');
  });

  it('preserves course code spacing and forwards coreCourseId', async () => {
    findByPk.mockResolvedValue({
      id: 7,
      coreCourseId: 'cuid-core-121',
    });
    enrichCourseDetail.mockResolvedValue({
      id: 7,
      coreCourseId: 'cuid-core-121',
      code: 'COSC 121',
      name: 'Intro',
    });
    generateQuestionsMock.mockResolvedValue([{ content: 'Q', difficulty: 'easy', type: 'SA', answer: null }]);
    await extractQuestionsFromText('exam text', 7, 'm', {});
    const call = generateQuestionsMock.mock.calls[0][0];
    expect(call.courseCode).toBe('COSC 121');
    expect(call.courseId).toBe('cuid-core-121');
  });
});
