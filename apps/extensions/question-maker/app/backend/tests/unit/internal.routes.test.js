/**
 * Unit tests for the internal (Core → QM) cascade-delete endpoint (§802).
 * Mounts internalRoutes in an isolated Express app — no full app.js, no DB.
 */
import express from 'express';
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/config/settings.js', () => {
  const cfg = { eduaiApiKey: 'test-service-key' };
  return { config: cfg, default: cfg };
});

const mockCourseFindOne = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  Course: { findOne: (...args) => mockCourseFindOne(...args) },
}));

const { default: internalRoutes } = await import('../../src/routes/internal.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalRoutes);
  app.use((err, req, res, _next) => res.status(500).json({ success: false, error: err.message }));
  return app;
}

const app = buildApp();

beforeEach(() => {
  mockCourseFindOne.mockReset();
});

describe('DELETE /api/internal/courses/:coreCourseId', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).delete('/api/internal/courses/core-cuid-1');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: 'MISSING_SERVICE_KEY' });
    expect(mockCourseFindOne).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong service key', async () => {
    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', 'Bearer wrong-key');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, error: 'INVALID_SERVICE_KEY' });
    expect(mockCourseFindOne).not.toHaveBeenCalled();
  });

  it('destroys the linked QM course and reports deleted: true', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    mockCourseFindOne.mockResolvedValue({ id: 7, coreCourseId: 'core-cuid-1', destroy });

    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', 'Bearer test-service-key');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: true });
    expect(mockCourseFindOne).toHaveBeenCalledWith({ where: { coreCourseId: 'core-cuid-1' } });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('is idempotent: reports deleted: false when no QM course is linked', async () => {
    mockCourseFindOne.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-unknown')
      .set('Authorization', 'Bearer test-service-key');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: false });
  });

  it('passes DB errors to the error handler', async () => {
    mockCourseFindOne.mockRejectedValue(new Error('connection lost'));

    const res = await request(app)
      .delete('/api/internal/courses/core-cuid-1')
      .set('Authorization', 'Bearer test-service-key');

    expect(res.status).toBe(500);
  });
});
