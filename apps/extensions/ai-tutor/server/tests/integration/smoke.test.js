import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor } from '../helpers.js';

describe('Smoke test', () => {
  it('GET /api/health returns { ok: true }', async () => {
    const app = await createApp({ mockUser: makeProfessor() });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
