import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockFindMany = vi.fn();
const mockCreate = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    promptTemplate: {
      findMany: (...args) => mockFindMany(...args),
      create: (...args) => mockCreate(...args),
    },
  },
}));

const { default: promptsRoutes } = await import('../../src/routes/prompts.js');

function buildApp(role = 'INSTRUCTOR') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (role) req.user = { role, id: 'u1' };
    next();
  });
  app.use('/api', promptsRoutes);
  return app;
}

beforeEach(() => {
  mockFindMany.mockReset();
  mockCreate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/prompts', () => {
  it('requires INSTRUCTOR role', async () => {
    const app = buildApp('STUDENT');
    const res = await request(app).get('/api/prompts');
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/api/prompts');
    expect(res.status).toBe(401);
  });

  it('lists prompts ordered by updatedAt desc', async () => {
    const rows = [{ id: 1, name: 'A' }];
    mockFindMany.mockResolvedValue(rows);
    const app = buildApp('INSTRUCTOR');

    const res = await request(app).get('/api/prompts');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(mockFindMany).toHaveBeenCalledWith({ orderBy: { updatedAt: 'desc' } });
  });

  it('returns 500 on a DB error', async () => {
    mockFindMany.mockRejectedValue(new Error('db down'));
    const app = buildApp('INSTRUCTOR');

    const res = await request(app).get('/api/prompts');

    expect(res.status).toBe(500);
  });
});

describe('POST /api/prompts', () => {
  it('requires INSTRUCTOR role', async () => {
    const app = buildApp('STUDENT');
    const res = await request(app).post('/api/prompts').send({ name: 'x', systemPrompt: 'y' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    const app = buildApp('INSTRUCTOR');
    const res = await request(app).post('/api/prompts').send({ systemPrompt: 'y' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'name and systemPrompt are required' });
  });

  it('returns 400 when systemPrompt is missing', async () => {
    const app = buildApp('INSTRUCTOR');
    const res = await request(app).post('/api/prompts').send({ name: 'x' });
    expect(res.status).toBe(400);
  });

  it('creates a prompt with a fresh slug when there is no collision', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'p1', ...data }));
    const app = buildApp('INSTRUCTOR');

    const res = await request(app)
      .post('/api/prompts')
      .send({ name: 'My Great Prompt', systemPrompt: 'Be helpful', temperature: 0.5, topP: 0.9 });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('my-great-prompt');
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: 'My Great Prompt',
        slug: 'my-great-prompt',
        systemPrompt: 'Be helpful',
        temperature: 0.5,
        topP: 0.9,
      },
    });
  });

  it('nulls out temperature/topP when they are not numbers', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'p1', ...data }));
    const app = buildApp('INSTRUCTOR');

    await request(app)
      .post('/api/prompts')
      .send({ name: 'X', systemPrompt: 'Y', temperature: 'hot', topP: null });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ temperature: null, topP: null }),
    });
  });

  it('appends -2 to the slug on a first collision', async () => {
    mockFindMany.mockResolvedValue([{ slug: 'my-prompt' }]);
    mockCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'p2', ...data }));
    const app = buildApp('INSTRUCTOR');

    const res = await request(app).post('/api/prompts').send({ name: 'My Prompt', systemPrompt: 'Y' });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('my-prompt-2');
  });

  it('walks past multiple collisions to find a free suffix', async () => {
    mockFindMany.mockResolvedValue([
      { slug: 'my-prompt' },
      { slug: 'my-prompt-2' },
      { slug: 'my-prompt-3' },
    ]);
    mockCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'p3', ...data }));
    const app = buildApp('INSTRUCTOR');

    const res = await request(app).post('/api/prompts').send({ name: 'My Prompt', systemPrompt: 'Y' });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('my-prompt-4');
  });

  it('falls back to "prompt" as the base slug when the name has no alphanumerics', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'p4', ...data }));
    const app = buildApp('INSTRUCTOR');

    const res = await request(app).post('/api/prompts').send({ name: '!!!', systemPrompt: 'Y' });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('prompt');
  });

  it('returns 500 when creation fails', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCreate.mockRejectedValue(new Error('db exploded'));
    const app = buildApp('INSTRUCTOR');

    const res = await request(app).post('/api/prompts').send({ name: 'X', systemPrompt: 'Y' });

    expect(res.status).toBe(500);
  });
});
