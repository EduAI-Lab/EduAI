import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { default: aiStatusRoutes } = await import('../../src/routes/ai-status.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', aiStatusRoutes);
  return app;
}

const app = buildApp();
const UNKNOWN = { state: 'unknown', detail: 'Status unavailable.' };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/ai-status', () => {
  it('proxies Core status through on a healthy response', async () => {
    const payload = { cloud: { state: 'online', detail: 'ok' }, ubc: { state: 'offline', detail: 'no' } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => payload });

    const res = await request(app).get('/api/ai-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });

  it('passes an AbortSignal timeout to the upstream fetch', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({ cloud: UNKNOWN, ubc: UNKNOWN }) });

    await request(app).get('/api/ai-status');

    const [, opts] = fetchMock.mock.calls[0];
    // A bounded probe: an AbortSignal must be attached so a hung Core can't
    // hang the poll open indefinitely.
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back to UNKNOWN chips when the upstream fetch aborts (timeout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
    );

    const res = await request(app).get('/api/ai-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cloud: UNKNOWN, ubc: UNKNOWN });
  });

  it('falls back to UNKNOWN chips on a non-ok upstream response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });

    const res = await request(app).get('/api/ai-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cloud: UNKNOWN, ubc: UNKNOWN });
  });
});
