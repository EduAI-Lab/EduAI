import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor } from '../helpers.js';

describe('CORS integration', () => {
  it('does not include Access-Control-Allow-Origin for an untrusted origin', async () => {
    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns a normal response (not 500) for an untrusted origin', async () => {
    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not include Access-Control-Allow-Origin when no Origin header is present', async () => {
    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS integration — preflight rejection', () => {
  it('rejects preflight from an untrusted origin without 500', async () => {
    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
  });
});
