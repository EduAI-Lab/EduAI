import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/settings.js', () => ({
  config: {
    qmAiRateLimitWindowMs: 60_000,
    qmAiRateLimitMax: 1,
    qmGeneratePromptMaxChars: 12_000,
    maxQuestions: 50,
  },
}));

const { qmAiUserRateLimit } = await import('../../src/middleware/aiAdmission.js');

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'caller-1' };
    next();
  });
  app.post('/generate', qmAiUserRateLimit, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('shared QM AI admission limiter', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
  });

  it('uses the authenticated caller as the budget key across routes', async () => {
    const first = await request(app).post('/generate');
    const second = await request(app).post('/generate');

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/AI request limit exceeded/i);
  });
});

