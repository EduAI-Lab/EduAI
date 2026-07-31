import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockGetAiModelPolicyState = vi.fn();

vi.mock('../../src/services/aiModelPolicy.js', () => ({
  getAiModelPolicyState: (...args) => mockGetAiModelPolicyState(...args),
}));

const { default: aiModelsRoutes } = await import('../../src/routes/ai-models.js');

function buildApp({ role } = {}) {
  const app = express();
  app.use(express.json());
  if (role) {
    app.use((req, _res, next) => {
      req.user = { role, id: 'u1' };
      next();
    });
  }
  app.use('/api', aiModelsRoutes);
  return app;
}

beforeEach(() => {
  mockGetAiModelPolicyState.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/ai-models', () => {
  const availableModels = [
    { modelId: 'google:gemini-2.5-flash', modelName: 'Gemini Flash' },
    { modelId: 'openai:o1', modelName: 'o1' },
  ];
  const policy = { allowedTutorModelIds: ['google:gemini-2.5-flash'] };

  it('filters models down to the allow-list for STUDENT users', async () => {
    mockGetAiModelPolicyState.mockResolvedValue({ policy, availableModels, availableModelsError: null });
    const app = buildApp({ role: 'STUDENT' });

    const res = await request(app).get('/api/ai-models');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      modelId: 'google:gemini-2.5-flash',
      studentSelectable: true,
      availability: 'allowed',
    });
  });

  it('returns every model annotated with availability for non-STUDENT users', async () => {
    mockGetAiModelPolicyState.mockResolvedValue({ policy, availableModels, availableModelsError: null });
    const app = buildApp({ role: 'INSTRUCTOR' });

    const res = await request(app).get('/api/ai-models');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const flash = res.body.find((m) => m.modelId === 'google:gemini-2.5-flash');
    const o1 = res.body.find((m) => m.modelId === 'openai:o1');
    expect(flash).toMatchObject({ studentSelectable: true, availability: 'allowed' });
    expect(o1).toMatchObject({ studentSelectable: false, availability: 'admin-only' });
  });

  it('treats a request with no req.user like a non-student (returns all models)', async () => {
    mockGetAiModelPolicyState.mockResolvedValue({ policy, availableModels, availableModelsError: null });
    const app = buildApp();

    const res = await request(app).get('/api/ai-models');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns 500 when the policy state lookup throws', async () => {
    mockGetAiModelPolicyState.mockRejectedValue(new Error('catalog unavailable'));
    const app = buildApp({ role: 'ADMIN' });

    const res = await request(app).get('/api/ai-models');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to load AI models');
  });
});

describe('POST /api/ai-models/validate-key', () => {
  it('returns 400 when provider is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/ai-models/validate-key').send({ apiKey: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ valid: false, error: 'Missing provider or apiKey' });
  });

  it('returns 400 when apiKey is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/ai-models/validate-key').send({ provider: 'google' });
    expect(res.status).toBe(400);
  });

  it('returns valid: true for google when the upstream responds ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    const app = buildApp();

    const res = await request(app)
      .post('/api/ai-models/validate-key')
      .send({ provider: 'google', apiKey: 'k' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
  });

  it('returns 200 valid: false for google when the upstream responds 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'bad key' } }),
    });
    const app = buildApp();

    const res = await request(app)
      .post('/api/ai-models/validate-key')
      .send({ provider: 'google', apiKey: 'bad' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, error: 'bad key' });
  });

  it('falls back to a generic message for google when the error body has no message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    });
    const app = buildApp();

    const res = await request(app)
      .post('/api/ai-models/validate-key')
      .send({ provider: 'google', apiKey: 'bad' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, error: 'Invalid API key' });
  });

  it('returns valid: true for openai when the upstream responds ok', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    const app = buildApp();

    const res = await request(app)
      .post('/api/ai-models/validate-key')
      .send({ provider: 'openai', apiKey: 'k' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer k');
  });

  it('returns 200 valid: false for openai when the upstream responds 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'invalid_api_key' } }),
    });
    const app = buildApp();

    const res = await request(app)
      .post('/api/ai-models/validate-key')
      .send({ provider: 'openai', apiKey: 'bad' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, error: 'invalid_api_key' });
  });

  it('returns 200 valid: false for an unsupported provider without calling fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = buildApp();

    const res = await request(app)
      .post('/api/ai-models/validate-key')
      .send({ provider: 'anthropic', apiKey: 'k' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, error: 'Unsupported provider: anthropic' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the upstream fetch throws (network failure)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const app = buildApp();

    const res = await request(app)
      .post('/api/ai-models/validate-key')
      .send({ provider: 'google', apiKey: 'k' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ valid: false, error: 'Validation request failed' });
  });
});
