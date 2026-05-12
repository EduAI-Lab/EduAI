/**
 * Ensures EduAI proxy routes require authentication (no DB).
 */
import request from 'supertest';
import app from '../src/app.js';

const expect401 = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ success: false });
};

describe('POST /api/eduai/* without token', () => {
  it('rejects /chat', async () => {
    const res = await request(app)
      .post('/api/eduai/chat')
      .send({ messages: [], courseCode: 'X' });
    expect401(res);
  });

  it('rejects /generate-questions', async () => {
    const res = await request(app)
      .post('/api/eduai/generate-questions')
      .send({ prompt: 'x', courseCode: 'X' });
    expect401(res);
  });
});

describe('GET /api/eduai/* without token', () => {
  it('rejects /courses', async () => {
    const res = await request(app).get('/api/eduai/courses');
    expect401(res);
  });

  it('rejects /courses/:id/topics', async () => {
    const res = await request(app).get('/api/eduai/courses/1/topics');
    expect401(res);
  });

  it('rejects /test-api-key', async () => {
    const res = await request(app).get('/api/eduai/test-api-key');
    expect401(res);
  });

  it('rejects /ai-models', async () => {
    const res = await request(app).get('/api/eduai/ai-models');
    expect401(res);
  });
});
