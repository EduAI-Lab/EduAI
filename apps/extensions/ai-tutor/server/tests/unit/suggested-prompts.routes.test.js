import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockFindMany = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    suggestedPrompt: {
      findMany: (...args) => mockFindMany(...args),
    },
  },
}));

const { default: suggestedPromptsRoutes } = await import('../../src/routes/suggested-prompts.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', suggestedPromptsRoutes);
  return app;
}

const app = buildApp();

beforeEach(() => {
  mockFindMany.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/suggested-prompts', () => {
  it('returns active prompts selecting id/mode/text', async () => {
    const rows = [{ id: 1, mode: 'teach', text: 'Explain this' }];
    mockFindMany.mockResolvedValue(rows);

    const res = await request(app).get('/api/suggested-prompts');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ mode: 'asc' }, { position: 'asc' }],
      select: { id: true, mode: true, text: true },
    });
  });

  it('returns 500 on a DB error', async () => {
    mockFindMany.mockRejectedValue(new Error('db down'));

    const res = await request(app).get('/api/suggested-prompts');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to load suggested prompts' });
  });
});
