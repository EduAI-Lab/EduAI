/**
 * Ensures assessment variant routes require authentication (no DB).
 */
import request from 'supertest';
import app from '../src/app.js';

const expect401 = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ success: false });
};

describe('GET /api/assessment-variant/* without token', () => {
  it('rejects blueprint-snapshot', async () => {
    const res = await request(app).get('/api/assessment-variant/assessments/1/blueprint-snapshot');
    expect401(res);
  });

  it('rejects variant-readiness without courseId', async () => {
    const res = await request(app).get('/api/assessment-variant/assessments/1/variant-readiness');
    expect401(res);
  });
});

describe('POST /api/assessment-variant/* without token', () => {
  it('rejects assemble-variants', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/assemble-variants')
      .send({ referenceAssessmentId: 1, courseId: 1 });
    expect401(res);
  });

  it('rejects assemble-by-metadata', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/assemble-by-metadata')
      .send({ referenceAssessmentId: 1, courseId: 1 });
    expect401(res);
  });

  it('rejects generate-bank-variants', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/generate-bank-variants')
      .send({ courseId: 1, questionIds: [1] });
    expect401(res);
  });

  it('rejects review-variant-ai', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/review-variant-ai')
      .send({
        baselineAssessmentId: 1,
        variantAssessmentId: 2,
        courseId: 1
      });
    expect401(res);
  });
});

describe('PATCH /api/assessment-variant/assessments/:id/role without token', () => {
  it('rejects set role', async () => {
    const res = await request(app)
      .patch('/api/assessment-variant/assessments/1/role')
      .send({ studyRole: 'reference_baseline' });
    expect401(res);
  });
});
