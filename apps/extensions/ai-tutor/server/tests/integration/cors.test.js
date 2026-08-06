import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { makeProfessor } from '../helpers.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalCorsOrigins = process.env.CORS_ORIGINS;

beforeEach(() => {
  vi.resetModules();
  delete process.env.CORS_ORIGINS;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalCorsOrigins === undefined) {
    delete process.env.CORS_ORIGINS;
  } else {
    process.env.CORS_ORIGINS = originalCorsOrigins;
  }
});

describe('CORS integration - local test default', () => {
  it('allows the local SPA when CORS_ORIGINS is unset', async () => {
    delete process.env.CORS_ORIGINS;

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', 'session=test');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('CORS integration — successful listed-origin request', () => {
  it('allows a GET from a listed origin and returns correct CORS headers', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', 'session=test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('CORS integration — successful listed-origin preflight', () => {
  it('allows OPTIONS from a listed origin and returns correct CORS headers', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('CORS integration — rejection', () => {
  it('untrusted GET has no Access-Control-Allow-Origin', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('untrusted OPTIONS has no Access-Control-Allow-Origin', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('request without Origin has no Access-Control-Allow-Origin', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Origin: null has no Access-Control-Allow-Origin', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app).get('/api/health').set('Origin', 'null');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('malformed Origin has no Access-Control-Allow-Origin', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app).get('/api/health').set('Origin', 'not-a-valid-origin-!@#$');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('prefix-match lookalike has no Access-Control-Allow-Origin', async () => {
    process.env.CORS_ORIGINS = 'https://trusted.example.com';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://trusted.example.com.evil.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unset CORS_ORIGINS blocks normal cross-origin request in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:3001');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unset CORS_ORIGINS blocks preflight cross-origin request in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('untrusted origin does not cause a 500 response', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    const { createApp } = await import('../../src/app.js');

    const app = await createApp({ mockUser: makeProfessor() });

    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
