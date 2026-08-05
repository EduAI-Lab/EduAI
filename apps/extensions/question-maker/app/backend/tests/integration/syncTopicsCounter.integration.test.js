/**
 * Regression tests for POST /api/course/:id/sync-topics synced counter.
 *
 * Bug: the `synced` counter only incremented when a new topic was created or
 * when a topic was linked by name match. Topics already linked by coreTopicId
 * whose names were updated were NOT counted, so after the first sync the
 * response always returned { synced: 0 } even when real name-update work was done.
 *
 * All DB (Prisma) and Core HTTP calls are mocked — no test DB required.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    port: 8000,
    nodeEnv: 'test',
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    coreUrl: 'http://core.test',
    extensionUrl: 'http://localhost:8000',
    encryptionKey: 'test-encryption-key-32bytes!!!!!',
    corsOrigins: ['*'],
    groqApiKey: '',
    openaiApiKey: '',
    deepseekApiKey: '',
    eduaiApiUrl: 'https://eduai.ok.ubc.ca',
    eduaiApiKey: 'test-service-key',
    eduaiIgnoredCourseCodes: [],
    defaultNumQuestions: 15,
    maxQuestions: 50,
    rateLimitWindowMs: 900000,
    rateLimitMax: 1000,
    logLevel: 'silent',
  };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: vi.fn() },
    topics: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    questionMetadata: {},
  },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseTopicsFromCore: vi.fn(),
  pushTopicToCore: vi.fn(),
  pushQuestionToCore: vi.fn(),
  patchQuestionTestableOnCore: vi.fn(),
  // courseAccess.js's requireCourseAccess({ min: 'instructor' }) resolves an
  // active Core enrollment for linked courses (SEAM-02: fail-closed, so this
  // must succeed rather than throw) — the instructor is on the roster here.
  // (id literal duplicates INSTRUCTOR.id below — vi.mock factories are
  // hoisted above the later `const INSTRUCTOR` and can't reference it.)
  getCourseEnrollmentsFromCore: vi.fn().mockResolvedValue({
    enrollments: [{ studentId: 'user-cuid-inst', role: 'INSTRUCTOR', isActive: true }],
  }),
}));

const { default: app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/database.js');
const { getCourseTopicsFromCore } = await import('../../src/services/coreApiService.js');

const INSTRUCTOR = { id: 'user-cuid-inst', email: 'inst@test.com', role: 'INSTRUCTOR', name: 'Instructor' };

function sessionOk(user = INSTRUCTOR) {
  return { ok: true, json: () => Promise.resolve({ user }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/course/:id/sync-topics  —  synced counter correctness
// ---------------------------------------------------------------------------
describe('POST /api/course/:id/sync-topics — synced counter', () => {
  it('counts already-linked topics whose names are updated (previously returned 0)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk()));

    prisma.course.findUnique.mockResolvedValue({
      id: 1,
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-1',
    });

    getCourseTopicsFromCore.mockResolvedValue({
      topics: [{ id: 'core-t-1', name: 'Renamed Topic' }],
    });

    // Local topic already linked to Core by coreTopicId — name update path
    const mockExistingTopic = {
      id: 'local-t-1',
      name: 'Old Name',
      courseId: 1,
      coreTopicId: 'core-t-1',
      update: vi.fn().mockResolvedValue(undefined),
    };
    // findAll #1: topics for this course; findAll #2: topics linked by coreTopicId
    prisma.topics.findMany
      .mockResolvedValueOnce([mockExistingTopic])
      .mockResolvedValueOnce([mockExistingTopic]);

    const res = await request(app)
      .post('/api/course/1/sync-topics')
      .set('Cookie', 'session=valid')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Bug: currently returns 0 because synced++ is only in the create/link branches
    expect(res.body.data.synced).toBe(1);
  });

  it('counts newly created topics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk()));

    prisma.course.findUnique.mockResolvedValue({
      id: 2,
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-2',
    });

    getCourseTopicsFromCore.mockResolvedValue({
      topics: [{ id: 'core-t-new', name: 'Brand New Topic' }],
    });

    // No existing topics locally → create path
    prisma.topics.findMany
      .mockResolvedValueOnce([]) // topics for this course
      .mockResolvedValueOnce([]); // topics linked by coreTopicId
    prisma.topics.create.mockResolvedValue({ id: 'local-t-new', name: 'Brand New Topic', coreTopicId: 'core-t-new' });

    const res = await request(app)
      .post('/api/course/2/sync-topics')
      .set('Cookie', 'session=valid')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBe(1);
  });

  it('counts multiple topics across all update paths', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk()));

    prisma.course.findUnique.mockResolvedValue({
      id: 3,
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-3',
    });

    getCourseTopicsFromCore.mockResolvedValue({
      topics: [
        { id: 'core-t-linked', name: 'Updated Linked Topic' },
        { id: 'core-t-brand-new', name: 'New Topic' },
      ],
    });

    // First topic: already linked by coreTopicId (name-update path)
    const linkedTopic = {
      id: 'local-t-linked',
      name: 'Old Linked Name',
      courseId: 3,
      coreTopicId: 'core-t-linked',
      update: vi.fn().mockResolvedValue(undefined),
    };
    // Second topic has no local match → create path.
    // findAll #1: topics for this course; findAll #2: topics linked by coreTopicId
    prisma.topics.findMany
      .mockResolvedValueOnce([linkedTopic])
      .mockResolvedValueOnce([linkedTopic]);
    prisma.topics.create.mockResolvedValue({ id: 'local-t-new2', name: 'New Topic', coreTopicId: 'core-t-brand-new' });

    const res = await request(app)
      .post('/api/course/3/sync-topics')
      .set('Cookie', 'session=valid')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBe(2);
  });
});
