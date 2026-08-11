import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { default: aiModelsRoutes, __resetKeyValidationStateForTests } =
  await import('../../src/routes/ai-models.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'opencode-test-user', role: 'STUDENT' };
    next();
  });
  app.use('/api', aiModelsRoutes);
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
  __resetKeyValidationStateForTests();
});

describe('OpenCode key validation', () => {
  it('uses a bounded chat-completions probe and forwards the key only as Bearer auth', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const response = await request(buildApp())
      .post('/api/ai-models/validate-key')
      .send({ provider: 'opencode', apiKey: 'opencode-secret' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(String(url)).not.toContain('opencode-secret');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer opencode-secret' });
    expect(options.body).toContain('deepseek-v4-flash');
  });

  it('returns valid false for OpenCode 401 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } }),
    });

    const response = await request(buildApp())
      .post('/api/ai-models/validate-key')
      .send({ provider: 'opencode', apiKey: 'bad' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ valid: false, error: 'Unauthorized' });
  });

  it('returns 504 when the bounded OpenCode probe times out', async () => {
    vi.stubEnv('AI_KEY_VALIDATION_TIMEOUT_MS', '5');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, options = {}) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        }),
    );

    const response = await request(buildApp())
      .post('/api/ai-models/validate-key')
      .send({ provider: 'opencode', apiKey: 'timeout-key' });

    expect(response.status).toBe(504);
    expect(response.body).toEqual({ valid: false, error: 'Validation request timed out' });
  });
});
