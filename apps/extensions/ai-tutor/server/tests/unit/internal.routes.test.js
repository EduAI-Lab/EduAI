import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockDeleteManyOfferings = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: {
      deleteMany: (...args) => mockDeleteManyOfferings(...args),
    },
  },
}));

const { default: internalRoutes } = await import('../../src/routes/internal.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', internalRoutes);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const app = buildApp();

beforeEach(() => {
  process.env.EDUAI_API_KEY = 'test-service-key';
  mockDeleteManyOfferings.mockReset();
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  vi.restoreAllMocks();
});

describe('DELETE /api/internal/courses/:coreOfferingId', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).delete('/api/internal/courses/core-cuid-1');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'MISSING_SERVICE_KEY' });
    expect(mockDeleteManyOfferings).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong service key', async () => {
    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', 'Bearer wrong-key');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'INVALID_SERVICE_KEY' });
    expect(mockDeleteManyOfferings).not.toHaveBeenCalled();
  });

  it('rejects when EDUAI_API_KEY is not configured', async () => {
    delete process.env.EDUAI_API_KEY;
    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', 'Bearer whatever');
    expect(res.status).toBe(403);
  });

  it('deletes the linked CourseOffering and reports deleted: true', async () => {
    mockDeleteManyOfferings.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', 'Bearer test-service-key');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: true });
    expect(mockDeleteManyOfferings).toHaveBeenCalledWith({
      where: { coreOfferingId: 'core-cuid-1' },
    });
  });

  it('is idempotent: reports deleted: false when no CourseOffering is linked', async () => {
    mockDeleteManyOfferings.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-unknown')
      .set('Authorization', 'Bearer test-service-key');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: false });
  });

  it('passes DB errors to the error handler', async () => {
    mockDeleteManyOfferings.mockRejectedValue(new Error('connection lost'));

    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', 'Bearer test-service-key');

    expect(res.status).toBe(500);
  });
});
