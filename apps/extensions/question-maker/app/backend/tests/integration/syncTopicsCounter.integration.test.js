/**
 * Regression tests for POST /api/course/:id/sync-topics synced counter.
 *
 * Bug: the `synced` counter only incremented when a new topic was created or
 * when a topic was linked by name match. Topics already linked by coreTopicId
 * whose names were updated were NOT counted, so after the first sync the
 * response always returned { synced: 0 } even when real name-update work was done.
 *
 * All DB (Sequelize) and Core HTTP calls are mocked — no test DB required.
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

vi.mock('../../src/schema/index.js', () => ({
  Course: { findOne: vi.fn() },
  Topics: { findAll: vi.fn(), create: vi.fn() },
  Question_Metadata: {},
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseTopicsFromCore: vi.fn(),
  pushTopicToCore: vi.fn(),
  pushQuestionToCore: vi.fn(),
  patchQuestionTestableOnCore: vi.fn(),
  findScopedCoreCourseByCode: vi.fn(),
  isCoreCourseInScopedList: vi.fn(),
  listCoursesFromCore: vi.fn(),
}));

const { default: app } = await import('../../src/app.js');
const { Course, Topics } = await import('../../src/schema/index.js');
const { getCourseTopicsFromCore } = await import('../../src/services/coreApiService.js');

const INSTRUCTOR = { id: 'user-cuid-inst', email: 'inst@test.com', role: 'INSTRUCTOR', name: 'Instructor' };

function sessionOk(user = INSTRUCTOR) {
  return { ok: true, json: () => Promise.resolve({ user }) };
}

/** topicSyncService loads local topics and global coreTopicId matches in two findAll calls. */
function mockTopicFindAll(localTopics, topicsByCoreId = localTopics) {
  Topics.findAll
    .mockResolvedValueOnce(localTopics)
    .mockResolvedValueOnce(topicsByCoreId);
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

    Course.findOne.mockResolvedValue({
      id: 'course-1',
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-1',
    });

    getCourseTopicsFromCore.mockResolvedValue({
      topics: [{ id: 'core-t-1', name: 'Renamed Topic' }],
    });

    const mockExistingTopic = {
      id: 'local-t-1',
      name: 'Old Name',
      courseId: 'course-1',
      coreTopicId: 'core-t-1',
      update: vi.fn().mockResolvedValue(undefined),
    };
    mockTopicFindAll([mockExistingTopic]);

    const res = await request(app)
      .post('/api/course/course-1/sync-topics')
      .set('Cookie', 'session=valid')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.synced).toBe(1);
    expect(mockExistingTopic.update).toHaveBeenCalledWith({ name: 'Renamed Topic' });
  });

  it('counts newly created topics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk()));

    Course.findOne.mockResolvedValue({
      id: 'course-2',
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-2',
    });

    getCourseTopicsFromCore.mockResolvedValue({
      topics: [{ id: 'core-t-new', name: 'Brand New Topic' }],
    });

    mockTopicFindAll([]);
    Topics.create.mockResolvedValue({ id: 'local-t-new', name: 'Brand New Topic', coreTopicId: 'core-t-new' });

    const res = await request(app)
      .post('/api/course/course-2/sync-topics')
      .set('Cookie', 'session=valid')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBe(1);
    expect(Topics.create).toHaveBeenCalledWith({
      name: 'Brand New Topic',
      courseId: 'course-2',
      coreTopicId: 'core-t-new',
    });
  });

  it('counts multiple topics across all update paths', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk()));

    Course.findOne.mockResolvedValue({
      id: 'course-3',
      userId: INSTRUCTOR.id,
      coreCourseId: 'core-c-3',
    });

    getCourseTopicsFromCore.mockResolvedValue({
      topics: [
        { id: 'core-t-linked', name: 'Updated Linked Topic' },
        { id: 'core-t-brand-new', name: 'New Topic' },
      ],
    });

    const linkedTopic = {
      id: 'local-t-linked',
      name: 'Old Linked Name',
      courseId: 'course-3',
      coreTopicId: 'core-t-linked',
      update: vi.fn().mockResolvedValue(undefined),
    };
    mockTopicFindAll([linkedTopic]);
    Topics.create.mockResolvedValue({ id: 'local-t-new2', name: 'New Topic', coreTopicId: 'core-t-brand-new' });

    const res = await request(app)
      .post('/api/course/course-3/sync-topics')
      .set('Cookie', 'session=valid')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBe(2);
    expect(linkedTopic.update).toHaveBeenCalledWith({ name: 'Updated Linked Topic' });
    expect(Topics.create).toHaveBeenCalledWith({
      name: 'New Topic',
      courseId: 'course-3',
      coreTopicId: 'core-t-brand-new',
    });
  });
});
