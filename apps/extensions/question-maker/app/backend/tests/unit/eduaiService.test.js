/**
 * Unit tests for the EduAIService singleton (src/services/eduaiService.js).
 *
 * axios is fully mocked so no network is touched; config is mocked so the singleton constructs
 * as "configured". The class is not exported, so the unconfigured branches are exercised by
 * temporarily blanking the instance's apiKey and restoring it afterward.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

vi.mock('../../src/config/settings.js', () => ({
  config: {
    eduaiApiUrl: 'http://eduai.test',
    eduaiApiKey: 'test-key-123456',
    eduaiIgnoredCourseCodes: [],
  },
}));

const axios = (await import('axios')).default;
const { config } = await import('../../src/config/settings.js');
const eduaiService = (await import('../../src/services/eduaiService.js')).default;

/** Builds an axios-style error carrying a server response. */
function responseError({ status = 500, statusText = 'Internal Server Error', data = {} } = {}) {
  return Object.assign(new Error('Request failed'), {
    response: { status, statusText, data, headers: {} },
    config: { url: 'http://eduai.test/api/chat' },
  });
}

/** Builds an axios-style error where the request was sent but no response came back. */
function requestError({ code, message = 'no response' } = {}) {
  return Object.assign(new Error(message), {
    request: {},
    code,
    config: { url: 'http://eduai.test/api/chat', baseURL: 'http://eduai.test', timeout: 60000 },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  config.eduaiIgnoredCourseCodes = [];
  eduaiService.apiKey = 'test-key-123456';
  eduaiService.baseURL = 'http://eduai.test';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isConfigured', () => {
  it('is true when an API key is present', () => {
    expect(eduaiService.isConfigured()).toBe(true);
  });

  it('is true when base URL is set even if the API key is blank', () => {
    eduaiService.apiKey = '';
    expect(eduaiService.isConfigured()).toBe(true);
  });

  it('is false when the base URL is blank', () => {
    eduaiService.baseURL = '';
    expect(eduaiService.isConfigured()).toBe(false);
  });
});

describe('chat', () => {
  it('throws when the service is not configured', async () => {
    eduaiService.apiKey = '';
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/not configured/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('posts to /api/chat and returns the response body', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: 'hello' } });

    const out = await eduaiService.chat({
      messages: [{ role: 'user', content: 'hi' }],
      courseCode: 'CS 101',
    });

    expect(out).toEqual({ content: 'hello' });
    const [url, payload, opts] = axios.post.mock.calls[0];
    expect(url).toBe('http://eduai.test/api/chat');
    expect(payload.courseCode).toBe('CS 101');
    // Core's requireServiceKey guard expects Authorization: Bearer (not x-api-key).
    expect(opts.headers['Authorization']).toBe('Bearer test-key-123456');
    expect(opts.headers['x-api-key']).toBeUndefined();
    expect(opts.timeout).toBe(60000);
  });

  it('honors an explicit timeoutMs override', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { message: 'ok' } });
    await eduaiService.chat({ messages: [], timeoutMs: 5000 });
    expect(axios.post.mock.calls[0][2].timeout).toBe(5000);
  });

  it('translates a server error response into a descriptive error', async () => {
    axios.post.mockRejectedValue(responseError({ status: 502, data: { error: 'upstream down' } }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/EduAI API error \(502\): upstream down/);
  });

  it('reports a timeout when the request aborts (ECONNABORTED)', async () => {
    axios.post.mockRejectedValue(requestError({ code: 'ECONNABORTED', message: 'timeout of 60000ms exceeded' }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/timed out/i);
  });

  it('reports an unreachable server (ECONNREFUSED)', async () => {
    axios.post.mockRejectedValue(requestError({ code: 'ECONNREFUSED' }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/unreachable/i);
  });

  it('reports a reset connection (ECONNRESET)', async () => {
    axios.post.mockRejectedValue(requestError({ code: 'ECONNRESET' }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/connection was reset/i);
  });

  it('reports a generic coded request failure', async () => {
    axios.post.mockRejectedValue(requestError({ code: 'EPIPE' }));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/EPIPE/);
  });

  it('wraps an error with neither response nor request', async () => {
    axios.post.mockRejectedValue(new Error('boom'));
    await expect(eduaiService.chat({ messages: [] })).rejects.toThrow(/EduAI API error: boom/);
  });
});

describe('generateQuestions', () => {
  const baseParams = { prompt: 'cells', courseCode: 'BIO 101' };

  it('throws when prompt or courseCode is missing', async () => {
    await expect(eduaiService.generateQuestions({ prompt: 'x' })).rejects.toThrow(/required/i);
  });

  it('normalizes a plain array of SA questions', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          { content: '  What is a cell?  ', description: 'Defn', difficulty: 'easy', reasoning_level: 'factual', type: 'SA', answer: ' the basic unit ' },
        ],
      },
    });

    const out = await eduaiService.generateQuestions(baseParams);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('What is a cell?');
    expect(out[0].type).toBe('SA');
    expect(out[0].answer).toBe('the basic unit');
    expect(out[0].choices).toBeNull();
  });

  it('parses a JSON string response and defaults bad difficulty/reasoning', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { content: JSON.stringify([{ content: 'Q?', type: 'LA', difficulty: 'spicy', reasoning_level: 'vibes', answer: 'A long answer' }]) },
    });

    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].difficulty).toBe('medium');
    expect(out[0].reasoning_level).toBe('factual');
    expect(out[0].type).toBe('LA');
  });

  it('extracts a JSON array embedded in surrounding prose', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { content: 'Sure! Here you go: [{"content":"Q?","type":"SA","difficulty":"hard","reasoning_level":"analytical","answer":"yes"}] done' },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].difficulty).toBe('hard');
  });

  it('unwraps a { questions: [...] } envelope', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { content: { questions: [{ content: 'Q?', type: 'SA', difficulty: 'easy', reasoning_level: 'factual', answer: 'a' }] } },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out).toHaveLength(1);
  });

  it('throws the model-reported reason when the response is an error object', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: { error: true, reason: 'topic not covered' } } });
    await expect(eduaiService.generateQuestions(baseParams)).rejects.toThrow(/topic not covered/);
  });

  it('throws when the parsed response is not a question array', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: { foo: 'bar' } } });
    await expect(eduaiService.generateQuestions(baseParams)).rejects.toThrow(/generation failed/i);
  });

  it('throws when no valid questions survive normalization', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: [{ description: 'no content field' }] } });
    await expect(eduaiService.generateQuestions(baseParams)).rejects.toThrow(/generation failed/i);
  });

  it('normalizes MCQ choices given as an object map and reduces the answer to a letter', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          {
            content: 'Pick one',
            type: 'MCQ',
            difficulty: 'easy',
            reasoning_level: 'factual',
            choices: { A: 'first', B: 'second' },
            answer: 'B) second',
          },
        ],
      },
    });

    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].type).toBe('MCQ');
    expect(out[0].choices).toEqual([
      { letter: 'A', text: 'first' },
      { letter: 'B', text: 'second' },
    ]);
    expect(out[0].answer).toBe('B');
  });

  it('parses MCQ choices embedded in the content body', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          { content: 'What color?\nA) Red\nB) Blue', type: 'MCQ', difficulty: 'easy', reasoning_level: 'factual', answer: 'A' },
        ],
      },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].content).toBe('What color?');
    expect(out[0].choices).toEqual([
      { letter: 'A', text: 'Red' },
      { letter: 'B', text: 'Blue' },
    ]);
  });

  it('falls back to placeholder choices for an MCQ with none (unenforced count)', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { content: [{ content: 'No choices here', type: 'MCQ', difficulty: 'easy', reasoning_level: 'factual', answer: 'A' }] },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].choices).toHaveLength(4);
  });

  it('leaves choices empty for an MCQ with none when an exact count is enforced', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { content: [{ content: 'No choices', type: 'MCQ', difficulty: 'easy', reasoning_level: 'factual', answer: 'A' }] },
    });
    const out = await eduaiService.generateQuestions({ ...baseParams, mcqRequiredChoiceCount: 4 });
    expect(out[0].choices).toEqual([]);
  });

  it('dedupes secondary topic ids and drops the primary from them', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        content: [
          { content: 'Q?', type: 'SA', difficulty: 'easy', reasoning_level: 'factual', answer: 'a', primary_topic_id: 5, secondary_topic_ids: [5, 6, 6, 7] },
        ],
      },
    });
    const out = await eduaiService.generateQuestions(baseParams);
    expect(out[0].primary_topic_id).toBe(5);
    expect(out[0].secondary_topic_ids).toEqual([6, 7]);
  });

  it('honors system/user prompt overrides without throwing', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { content: [{ content: 'Q?', type: 'SA', difficulty: 'easy', reasoning_level: 'factual', answer: 'a' }] },
    });
    await eduaiService.generateQuestions({ ...baseParams, systemPromptOverride: 'sys', userPromptOverride: 'usr' });
    const payload = axios.post.mock.calls[0][1];
    expect(payload.messages[0].content).toBe('sys');
    expect(payload.messages[1].content).toBe('usr');
  });
});

describe('listCourses', () => {
  it('throws when not configured', async () => {
    eduaiService.apiKey = '';
    await expect(eduaiService.listCourses()).rejects.toThrow(/not configured/i);
  });

  it('returns the data unchanged when no codes are ignored', async () => {
    axios.get.mockResolvedValue({ data: [{ id: 1, code: 'CS 101' }] });
    const out = await eduaiService.listCourses();
    expect(out).toEqual([{ id: 1, code: 'CS 101' }]);
  });

  it('filters ignored codes out of an array payload', async () => {
    config.eduaiIgnoredCourseCodes = ['CS101'];
    axios.get.mockResolvedValue({ data: [{ id: 1, code: 'CS 101' }, { id: 2, code: 'BIO 200' }] });
    const out = await eduaiService.listCourses();
    expect(out).toEqual([{ id: 2, code: 'BIO 200' }]);
  });

  it('filters ignored codes inside a { courses: [...] } envelope', async () => {
    config.eduaiIgnoredCourseCodes = ['bio200'];
    axios.get.mockResolvedValue({ data: { courses: [{ id: 1, code: 'CS 101' }, { id: 2, code: 'BIO 200' }] } });
    const out = await eduaiService.listCourses();
    expect(out.courses).toEqual([{ id: 1, code: 'CS 101' }]);
  });

  it('translates a server error response', async () => {
    axios.get.mockRejectedValue(responseError({ status: 404, data: { message: 'nope' } }));
    await expect(eduaiService.listCourses()).rejects.toThrow(/EduAI API error \(404\): nope/);
  });

  it('reports a no-response failure', async () => {
    axios.get.mockRejectedValue(requestError({ code: 'ETIMEDOUT' }));
    await expect(eduaiService.listCourses()).rejects.toThrow(/No response received/);
  });

  it('wraps a setup error', async () => {
    axios.get.mockRejectedValue(new Error('weird'));
    await expect(eduaiService.listCourses()).rejects.toThrow(/EduAI API error: weird/);
  });
});

describe('getCourseTopics', () => {
  it('throws when not configured', async () => {
    eduaiService.apiKey = '';
    await expect(eduaiService.getCourseTopics(1)).rejects.toThrow(/not configured/i);
  });

  it('throws when courseId is missing', async () => {
    await expect(eduaiService.getCourseTopics()).rejects.toThrow(/courseId is required/);
  });

  it('returns topic data on success', async () => {
    axios.get.mockResolvedValue({ data: [{ id: 9, name: 'Topic' }] });
    const out = await eduaiService.getCourseTopics(42);
    expect(out).toEqual([{ id: 9, name: 'Topic' }]);
    expect(axios.get.mock.calls[0][0]).toBe('http://eduai.test/api/courses/42/topics');
  });

  it('translates a server error response', async () => {
    axios.get.mockRejectedValue(responseError({ status: 500, statusText: 'ISE', data: {} }));
    await expect(eduaiService.getCourseTopics(42)).rejects.toThrow(/EduAI API error \(500\)/);
  });

  it('reports a no-response failure', async () => {
    axios.get.mockRejectedValue(requestError({ code: 'ECONNRESET' }));
    await expect(eduaiService.getCourseTopics(42)).rejects.toThrow(/No response received/);
  });
});

describe('listAIModels', () => {
  it('throws when not configured', async () => {
    eduaiService.apiKey = '';
    await expect(eduaiService.listAIModels()).rejects.toThrow(/not configured/i);
  });

  it('returns model data on success', async () => {
    axios.get.mockResolvedValue({ data: { models: ['a', 'b'] } });
    const out = await eduaiService.listAIModels();
    expect(out).toEqual({ models: ['a', 'b'] });
  });

  it('translates a server error response', async () => {
    axios.get.mockRejectedValue(responseError({ status: 503, data: { error: 'busy' } }));
    await expect(eduaiService.listAIModels()).rejects.toThrow(/EduAI API error \(503\): busy/);
  });

  it('wraps a setup error', async () => {
    axios.get.mockRejectedValue(new Error('odd'));
    await expect(eduaiService.listAIModels()).rejects.toThrow(/EduAI API error: odd/);
  });
});

describe('testApiKey', () => {
  it('returns failure when not configured', async () => {
    eduaiService.apiKey = '';
    const out = await eduaiService.testApiKey();
    expect(out).toEqual({ success: false, error: 'EduAI API key not configured' });
  });

  it('returns success when the chat call works', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: 'pong' } });
    const out = await eduaiService.testApiKey();
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/valid/i);
  });

  it('flags an invalid key on a 401', async () => {
    axios.post.mockRejectedValue(responseError({ status: 401, statusText: 'Unauthorized', data: {} }));
    const out = await eduaiService.testApiKey();
    expect(out).toEqual({ success: false, error: 'Invalid EduAI API key - authentication failed' });
  });

  it('flags forbidden access on a 403', async () => {
    axios.post.mockRejectedValue(responseError({ status: 403, statusText: 'Forbidden', data: {} }));
    const out = await eduaiService.testApiKey();
    expect(out).toEqual({ success: false, error: 'EduAI API key access forbidden' });
  });

  it('treats a provider-key failure as a valid EduAI key', async () => {
    axios.post.mockRejectedValue(responseError({ status: 400, data: { error: 'Invalid API key for provider' } }));
    const out = await eduaiService.testApiKey();
    expect(out.success).toBe(true);
    expect(out.note).toMatch(/provider API keys/i);
  });

  it('returns a generic failure for other errors', async () => {
    axios.post.mockRejectedValue(responseError({ status: 500, statusText: 'ISE', data: {} }));
    const out = await eduaiService.testApiKey();
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/API key test failed/);
  });

  it('reports the cloud path for any supported provider key, not just Google', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { content: 'pong' } });
    for (const provider of ['openai', 'deepseek', 'anthropic']) {
      const out = await eduaiService.testApiKey({
        apiKeys: { [provider]: { apiKey: 'sk-test', isEnabled: true } },
      });
      expect(out.success).toBe(true);
      expect(out.provider).toBe(provider);
    }
  });
});

describe('getConnectivityTestParams', () => {
  const savedConfigKey = config.googleGenerativeAiApiKey;
  afterEach(() => {
    config.googleGenerativeAiApiKey = savedConfigKey;
  });

  it('prefers a client cloud key over the UBC-hosted path', () => {
    const params = eduaiService.getConnectivityTestParams({
      openai: { apiKey: 'sk-openai', isEnabled: true },
    });
    expect(params.provider).toBe('openai');
    expect(params.model).toBe('openai:gpt-4o-mini');
    expect(params.apiKeys.openai.apiKey).toBe('sk-openai');
  });

  it('picks Google first when multiple client keys are present', () => {
    const params = eduaiService.getConnectivityTestParams({
      anthropic: { apiKey: 'sk-ant', isEnabled: true },
      google: { apiKey: 'g-key', isEnabled: true },
    });
    expect(params.provider).toBe('google');
  });

  it('falls back to the server Google key when no client key is present', () => {
    config.googleGenerativeAiApiKey = 'server-google';
    const params = eduaiService.getConnectivityTestParams({});
    expect(params.provider).toBe('google');
    expect(params.apiKeys.google.apiKey).toBe('server-google');
  });

  it('falls back to the UBC-hosted path when no cloud key exists at all', () => {
    config.googleGenerativeAiApiKey = undefined;
    const params = eduaiService.getConnectivityTestParams({});
    expect(params.provider).toBe('ollama');
  });
});
