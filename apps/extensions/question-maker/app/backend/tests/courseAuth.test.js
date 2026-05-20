/**
 * Ensures course/topic routes require authentication (no DB).
 */
import request from 'supertest';
import app from '../src/app.js';

const expect401 = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ success: false });
};

describe('GET /api/course without token', () => {
  it('rejects list', async () => {
    const res = await request(app).get('/api/course');
    expect401(res);
  });

  it('rejects by id', async () => {
    const res = await request(app).get('/api/course/1');
    expect401(res);
  });

  it('rejects topics sub-route', async () => {
    const res = await request(app).get('/api/course/1/topics');
    expect401(res);
  });
});

describe('POST /api/course without token', () => {
  it('rejects create', async () => {
    const res = await request(app)
      .post('/api/course')
      .send({ name: 'Test Course' });
    expect401(res);
  });

  it('rejects add topic', async () => {
    const res = await request(app)
      .post('/api/course/1/topics')
      .send({ name: 'Topic' });
    expect401(res);
  });
});
