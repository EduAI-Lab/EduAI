/**
 * Ensures question and extraction routes require authentication (no DB).
 */
import request from 'supertest';
import app from '../src/app.js';

const expect401 = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ success: false });
};

describe('GET /api/questions without token', () => {
  it('rejects list', async () => {
    const res = await request(app).get('/api/questions');
    expect401(res);
  });

  it('rejects /stats', async () => {
    const res = await request(app).get('/api/questions/stats');
    expect401(res);
  });

  it('rejects /:id (numeric id before other routes)', async () => {
    const res = await request(app).get('/api/questions/1');
    expect401(res);
  });
});

describe('POST /api/questions without token', () => {
  it('rejects create', async () => {
    const res = await request(app)
      .post('/api/questions')
      .send({ description: 'x', courseId: 1, primaryTopicId: 1, type: 'MCQ' });
    expect401(res);
  });

  it('rejects /extract', async () => {
    const res = await request(app)
      .post('/api/questions/extract')
      .send({ text: 'Q?', courseId: 1 });
    expect401(res);
  });

  it('rejects /extract/save', async () => {
    const res = await request(app)
      .post('/api/questions/extract/save')
      .send({ courseId: 1, questions: [] });
    expect401(res);
  });
});
