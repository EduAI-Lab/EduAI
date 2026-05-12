/**
 * HTTP smoke tests for routes that do not require a database.
 */
import request from 'supertest';
import app from '../src/app.js';

describe('GET /healthz', () => {
  it('returns 200 ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });
});

describe('GET /', () => {
  it('returns API status JSON', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      message: 'EduQuery.ai API is running',
      version: '1.0.0',
    });
  });
});

describe('unknown route', () => {
  it('returns 404 JSON', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
    expect(String(res.body.error)).toMatch(/not found/i);
  });
});
