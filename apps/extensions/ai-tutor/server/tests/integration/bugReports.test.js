import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeAdmin, makeProfessor, makeStudent } from '../helpers.js';

// Mock the Core client so tests don't require a live Core instance.
vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    postCoreBugReport: vi.fn().mockResolvedValue(null),
  };
});

const { postCoreBugReport } = await import('../../src/services/eduaiClient.js');

describe('Bug report routes', () => {
  let student;
  let professor;
  let admin;
  let studentApp;
  let professorApp;
  let adminApp;

  beforeEach(async () => {
    vi.clearAllMocks();

    student = makeStudent();
    professor = makeProfessor();
    admin = makeAdmin();

    studentApp = await createApp({ mockUser: student });
    professorApp = await createApp({ mockUser: professor });
    adminApp = await createApp({ mockUser: admin });
  });

  it('student can submit a page-level bug report', async () => {
    const res = await request(studentApp).post('/api/bug-reports').send({
      description: 'The lesson page froze after I clicked submit twice.',
      pageUrl: 'http://localhost:5173/student',
      userAgent: 'Vitest',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(postCoreBugReport).toHaveBeenCalledOnce();
    expect(postCoreBugReport).toHaveBeenCalledWith(
      student.id,
      expect.objectContaining({ description: 'The lesson page froze after I clicked submit twice.' }),
    );
  });

  it('professor can submit a page-level bug report', async () => {
    const res = await request(professorApp).post('/api/bug-reports').send({
      description: 'Builder toolbar disappeared while editing the question.',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(postCoreBugReport).toHaveBeenCalledOnce();
    expect(postCoreBugReport).toHaveBeenCalledWith(professor.id, expect.any(Object));
  });

  it('admin cannot submit to /api/bug-reports', async () => {
    const res = await request(adminApp).post('/api/bug-reports').send({
      description: 'Should not be allowed for admins.',
    });

    expect(res.status).toBe(403);
    expect(postCoreBugReport).not.toHaveBeenCalled();
  });

  it('unauthenticated requests are rejected with 401', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/bug-reports').send({
      description: 'Unauthenticated submission should fail.',
    });

    expect(res.status).toBe(401);
    expect(postCoreBugReport).not.toHaveBeenCalled();
  });

  it('rejects descriptions that are too short or too long', async () => {
    const shortRes = await request(studentApp).post('/api/bug-reports').send({
      description: 'Too short',
    });
    expect(shortRes.status).toBe(400);

    const longRes = await request(studentApp)
      .post('/api/bug-reports')
      .send({ description: 'x'.repeat(2001) });
    expect(longRes.status).toBe(400);

    expect(postCoreBugReport).not.toHaveBeenCalled();
  });

  it('passes userId to Core even when isAnonymous is true', async () => {
    const res = await request(studentApp).post('/api/bug-reports').send({
      description: 'Anonymous report identity masking test.',
      isAnonymous: true,
    });

    expect(res.status).toBe(201);
    expect(postCoreBugReport).toHaveBeenCalledOnce();
    const [calledUserId, calledPayload] = postCoreBugReport.mock.calls[0];
    expect(calledUserId).toBe(student.id);
    expect(calledPayload.isAnonymous).toBe(true);
  });

  it('Core errors surface as 500', async () => {
    postCoreBugReport.mockRejectedValueOnce(
      Object.assign(new Error('Core unavailable'), { status: 503 }),
    );

    const res = await request(studentApp).post('/api/bug-reports').send({
      description: 'Core is down, what happens here.',
    });

    expect(res.status).toBe(500);
  });
});
