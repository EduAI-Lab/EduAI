/**
 * Route-level integration tests for variant approval → Core push.
 *
 * questionService, coreWiringService, and the RBAC Core reads (coreApiService)
 * are mocked so no DB or live Core is needed. The variant the access middleware
 * loads is a DRAFT (pre-update); updateVariant returns the approved row used for
 * the push gate. Verifies the PUT handler's push-gating, 422 error shapes, and
 * re-approval after INVALID_TOPIC_IDS recovery, for an enrolled INSTRUCTOR.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

const {
  mockUpdateVariant,
  mockVariantsUpdate,
  mockTopicsUpdateMany,
  mockPushVariantToCore,
  mockVariantsFindOne,
  mockEnrollments,
} = vi.hoisted(() => ({
  mockUpdateVariant: vi.fn(),
  mockVariantsUpdate: vi.fn().mockResolvedValue(undefined),
  mockTopicsUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  mockPushVariantToCore: vi.fn(),
  mockVariantsFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

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

vi.mock('../../src/services/questionService.js', () => ({
  createVariant: vi.fn(),
  updateVariant: mockUpdateVariant,
  deleteVariant: vi.fn(),
  getVariantsByQuestion: vi.fn(),
}));

vi.mock('../../src/services/coreWiringService.js', () => ({
  pushVariantToCore: mockPushVariantToCore,
}));

// RBAC reads used by the course-access middleware.
vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
  patchQuestionTestableOnCore: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    variants: {
      findUnique: mockVariantsFindOne,
      update: mockVariantsUpdate,
    },
    questionMetadata: {},
    assessments: {},
    assessmentSections: {},
    course: {},
    topics: { updateMany: mockTopicsUpdateMany },
  },
}));

const { default: app } = await import('../../src/app.js');

const INSTRUCTOR = { id: 'cuid-instructor', email: 'inst@test.com', role: 'INSTRUCTOR', name: 'Instructor' };

function sessionOk() {
  return { ok: true, json: () => Promise.resolve({ user: INSTRUCTOR }) };
}

// The course the variant belongs to (owner id + coreCourseId drive scoping + push).
const COURSE = { id: 1, userId: 'cuid-owner', coreCourseId: 'cuid-core-course' };

// What the access middleware loads: a DRAFT variant pending approval.
function loadedDraft() {
  return {
    id: 42,
    isDraft: true,
    coreQuestionId: null,
    createdBy: INSTRUCTOR.id,
    questionMetadata: { type: 'SA', primaryTopicId: 'local-t1', course: COURSE },
  };
}

// What updateVariant returns: the approved row used by the push gate.
function makeVariant({ isDraft = false, coreQuestionId = null } = {}) {
  return {
    id: 42,
    isDraft,
    coreQuestionId,
    questionMetadata: { type: 'SA', primaryTopicId: 'local-t1', course: COURSE },
  };
}

function setup({ updated } = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk()));
  mockVariantsFindOne.mockResolvedValue(loadedDraft());
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: INSTRUCTOR.id, role: 'INSTRUCTOR', isActive: true }],
  });
  if (updated) mockUpdateVariant.mockResolvedValue(updated);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('PUT /api/questions/variants/:id — Core push on approval', () => {
  it('pushes to Core when isDraft=false and no coreQuestionId, stores returned id', async () => {
    setup({ updated: makeVariant({ isDraft: false, coreQuestionId: null }) });
    mockPushVariantToCore.mockResolvedValueOnce({ coreQuestionId: 'cuid-core-q' });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPushVariantToCore).toHaveBeenCalledOnce();
    expect(mockVariantsUpdate).toHaveBeenCalledWith({ where: { id: 42 }, data: { coreQuestionId: 'cuid-core-q' } });
  });

  it('does NOT push when isDraft is not explicitly false in the request body', async () => {
    setup({ updated: makeVariant({ isDraft: false, coreQuestionId: null }) });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ questionText: 'Updated text' });

    expect(res.status).toBe(200);
    expect(mockPushVariantToCore).not.toHaveBeenCalled();
  });

  it('does NOT push when variant already has coreQuestionId (already linked)', async () => {
    setup({ updated: makeVariant({ isDraft: false, coreQuestionId: 'existing-cuid' }) });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(200);
    expect(mockPushVariantToCore).not.toHaveBeenCalled();
  });

  it('returns 422 INVALID_TOPIC_IDS and nulls deleted topic coreTopicIds', async () => {
    const deletedTopicIds = ['cuid-deleted-topic'];
    const coreErr = Object.assign(new Error('INVALID_TOPIC_IDS'), {
      status: 422,
      body: { error: 'INVALID_TOPIC_IDS', deletedTopicIds, conflictingWithPrimary: [] },
    });
    setup({ updated: makeVariant({ isDraft: false, coreQuestionId: null }) });
    mockPushVariantToCore.mockRejectedValueOnce(coreErr);

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('INVALID_TOPIC_IDS');
    expect(res.body.deletedTopicIds).toEqual(deletedTopicIds);
    expect(mockTopicsUpdateMany).toHaveBeenCalledWith({ where: { coreTopicId: { in: deletedTopicIds } }, data: { coreTopicId: null } });
    expect(mockVariantsUpdate).not.toHaveBeenCalled();
  });

  it('re-approval after INVALID_TOPIC_IDS fires push again (state-based gating)', async () => {
    const deletedTopicIds = ['cuid-deleted-topic'];
    const coreErr = Object.assign(new Error('INVALID_TOPIC_IDS'), {
      status: 422,
      body: { error: 'INVALID_TOPIC_IDS', deletedTopicIds, conflictingWithPrimary: [] },
    });
    setup({ updated: makeVariant({ isDraft: false, coreQuestionId: null }) });

    // First approval → 422
    mockPushVariantToCore.mockRejectedValueOnce(coreErr);
    const firstRes = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });
    expect(firstRes.status).toBe(422);

    // Second approval after user fixes topics → push fires again and succeeds
    mockPushVariantToCore.mockResolvedValueOnce({ coreQuestionId: 'cuid-core-q-recovered' });
    const secondRes = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(secondRes.status).toBe(200);
    expect(mockPushVariantToCore).toHaveBeenCalledTimes(2);
    expect(mockVariantsUpdate).toHaveBeenCalledWith({ where: { id: 42 }, data: { coreQuestionId: 'cuid-core-q-recovered' } });
  });

  it('returns 422 DUPLICATE_TOPIC without storing coreQuestionId', async () => {
    const coreErr = Object.assign(new Error('DUPLICATE_TOPIC'), {
      status: 422,
      body: { error: 'DUPLICATE_TOPIC', conflictingIds: ['cuid-t1'] },
    });
    setup({ updated: makeVariant({ isDraft: false, coreQuestionId: null }) });
    mockPushVariantToCore.mockRejectedValueOnce(coreErr);

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DUPLICATE_TOPIC');
    expect(mockVariantsUpdate).not.toHaveBeenCalled();
  });

  // #225 SEAM-03 / #1197 fix: a Core push failure (Core down, 5xx, network
  // error) must surface as an error, not a false 200 success — the variant
  // is approved locally but not linked to Core, so a 200 here would let the
  // UI believe the question was published when it wasn't.
  it('returns 502 CORE_PUSH_FAILED when Core is unreachable, does not store a Core link', async () => {
    setup({ updated: makeVariant({ isDraft: false, coreQuestionId: null }) });
    mockPushVariantToCore.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('CORE_PUSH_FAILED');
    expect(mockVariantsUpdate).not.toHaveBeenCalled();
  });

  it('re-approval after a transient Core push failure retries the push (state-based gating)', async () => {
    setup({ updated: makeVariant({ isDraft: false, coreQuestionId: null }) });

    mockPushVariantToCore.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const firstRes = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });
    expect(firstRes.status).toBe(502);

    mockPushVariantToCore.mockResolvedValueOnce({ coreQuestionId: 'cuid-core-q-retry' });
    const secondRes = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(secondRes.status).toBe(200);
    expect(mockPushVariantToCore).toHaveBeenCalledTimes(2);
    expect(mockVariantsUpdate).toHaveBeenCalledWith({ where: { id: 42 }, data: { coreQuestionId: 'cuid-core-q-retry' } });
  });
});
