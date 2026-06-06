/**
 * Route-level integration tests for variant approval → Core push.
 *
 * questionService and coreWiringService are fully mocked so no DB or live Core is needed.
 * Verifies the PUT /variants/:id handler's push-gating, 422 error shapes, and
 * re-approval after INVALID_TOPIC_IDS recovery.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

// vi.hoisted ensures these are defined before vi.mock factories run
const {
  mockUpdateVariant,
  mockVariantUpdate,
  mockTopicsUpdate,
  mockPushVariantToCore,
  mockVariantsFindOne,
} = vi.hoisted(() => ({
  mockUpdateVariant: vi.fn(),
  mockVariantUpdate: vi.fn().mockResolvedValue(undefined),
  mockTopicsUpdate: vi.fn().mockResolvedValue([1]),
  mockPushVariantToCore: vi.fn(),
  mockVariantsFindOne: vi.fn(),
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

vi.mock('../../src/schema/index.js', () => ({
  Variants: {
    findByPk: vi.fn(),
    findOne: mockVariantsFindOne,
    update: mockTopicsUpdate,
  },
  Question_Metadata: {},
  Course: {},
  Topics: { update: mockTopicsUpdate },
  sequelize: { define: vi.fn(), authenticate: vi.fn(), sync: vi.fn() },
}));

const { default: app } = await import('../../src/app.js');

const INSTRUCTOR = { id: 'cuid-instructor', email: 'inst@test.com', role: 'INSTRUCTOR', name: 'Instructor' };

function sessionOk() {
  return { ok: true, json: () => Promise.resolve({ user: INSTRUCTOR }) };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// Returns a variant Sequelize-like instance with a real .update spy
function makeVariant({ isDraft = false, coreQuestionId = null } = {}) {
  return {
    id: 42,
    isDraft,
    coreQuestionId,
    update: mockVariantUpdate,
    questionMetadata: {
      type: 'SA',
      primaryTopicId: 'local-t1',
      course: { id: 1, coreCourseId: 'cuid-core-course' },
    },
  };
}

describe('PUT /api/questions/variants/:id — Core push on approval', () => {
  it('pushes to Core when isDraft=false and no coreQuestionId, stores returned id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionOk()));
    const v = makeVariant({ isDraft: false, coreQuestionId: null });
    mockUpdateVariant.mockResolvedValueOnce(v);
    mockVariantsFindOne.mockResolvedValueOnce(v);
    mockPushVariantToCore.mockResolvedValueOnce({ coreQuestionId: 'cuid-core-q' });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPushVariantToCore).toHaveBeenCalledOnce();
    expect(mockVariantUpdate).toHaveBeenCalledWith({ coreQuestionId: 'cuid-core-q' });
  });

  it('does NOT push when isDraft is not explicitly false in the request body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionOk()));
    mockUpdateVariant.mockResolvedValueOnce(makeVariant({ isDraft: false, coreQuestionId: null }));

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ questionText: 'Updated text' });

    expect(res.status).toBe(200);
    expect(mockPushVariantToCore).not.toHaveBeenCalled();
  });

  it('does NOT push when variant already has coreQuestionId (already linked)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionOk()));
    mockUpdateVariant.mockResolvedValueOnce(makeVariant({ isDraft: false, coreQuestionId: 'existing-cuid' }));

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk()));
    const v = makeVariant({ isDraft: false, coreQuestionId: null });
    mockUpdateVariant.mockResolvedValue(v);
    mockVariantsFindOne.mockResolvedValue(v);
    mockPushVariantToCore.mockRejectedValueOnce(coreErr);

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('INVALID_TOPIC_IDS');
    expect(res.body.deletedTopicIds).toEqual(deletedTopicIds);
    expect(mockTopicsUpdate).toHaveBeenCalledWith({ coreTopicId: null }, { where: { coreTopicId: deletedTopicIds } });
    expect(mockVariantUpdate).not.toHaveBeenCalled();
  });

  it('re-approval after INVALID_TOPIC_IDS fires push again (state-based gating)', async () => {
    const deletedTopicIds = ['cuid-deleted-topic'];
    const coreErr = Object.assign(new Error('INVALID_TOPIC_IDS'), {
      status: 422,
      body: { error: 'INVALID_TOPIC_IDS', deletedTopicIds, conflictingWithPrimary: [] },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionOk()));
    const v = makeVariant({ isDraft: false, coreQuestionId: null });
    mockUpdateVariant.mockResolvedValue(v);
    mockVariantsFindOne.mockResolvedValue(v);

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
    expect(mockVariantUpdate).toHaveBeenCalledWith({ coreQuestionId: 'cuid-core-q-recovered' });
  });

  it('returns 422 DUPLICATE_TOPIC without storing coreQuestionId', async () => {
    const coreErr = Object.assign(new Error('DUPLICATE_TOPIC'), {
      status: 422,
      body: { error: 'DUPLICATE_TOPIC', conflictingIds: ['cuid-t1'] },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionOk()));
    const v = makeVariant({ isDraft: false, coreQuestionId: null });
    mockUpdateVariant.mockResolvedValueOnce(v);
    mockVariantsFindOne.mockResolvedValueOnce(v);
    mockPushVariantToCore.mockRejectedValueOnce(coreErr);

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DUPLICATE_TOPIC');
    expect(mockVariantUpdate).not.toHaveBeenCalled();
  });

  it('approves locally (200) when Core is unreachable, logs warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionOk()));
    const v = makeVariant({ isDraft: false, coreQuestionId: null });
    mockUpdateVariant.mockResolvedValueOnce(v);
    mockVariantsFindOne.mockResolvedValueOnce(v);
    mockPushVariantToCore.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=valid')
      .send({ isDraft: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockVariantUpdate).not.toHaveBeenCalled();
  });
});
