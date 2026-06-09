/**
 * Route-level RBAC tests for variant authoring semantics (#312, §16/§19):
 *   - STUDENT flat-gated off every authoring route,
 *   - TA own-only edit/delete,
 *   - instructor-only approval (isDraft:false),
 *   - approved-variant 409 lock (revert-only, instructor-and-up).
 *
 * No DB / live Core: questionService, coreWiringService and the RBAC Core reads
 * (coreApiService) are mocked. The caller's enrollment role (mockEnrollments)
 * drives the resolved course-access level; the session role drives requireRole.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { mockUpdateVariant, mockDeleteVariant, mockVariantsFindOne, mockEnrollments } = vi.hoisted(() => ({
  mockUpdateVariant: vi.fn(),
  mockDeleteVariant: vi.fn().mockResolvedValue(true),
  mockVariantsFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/services/questionService.js', () => ({
  createVariant: vi.fn(),
  updateVariant: mockUpdateVariant,
  deleteVariant: mockDeleteVariant,
  getVariantsByQuestion: vi.fn(),
}));

vi.mock('../../src/services/coreWiringService.js', () => ({
  pushVariantToCore: vi.fn(),
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
  patchQuestionTestableOnCore: vi.fn(),
}));

vi.mock('../../src/schema/index.js', () => ({
  Variants: { findOne: mockVariantsFindOne, update: vi.fn() },
  Question_Metadata: {},
  Assessments: {},
  AssessmentSections: {},
  Course: {},
  Topics: { update: vi.fn() },
  sequelize: { define: vi.fn(), authenticate: vi.fn(), sync: vi.fn() },
}));

const { default: app } = await import('../../src/app.js');

const TA = { id: 'ta-1', email: 'ta@test.com', role: 'TA', name: 'Tee Ay' };
const INSTRUCTOR = { id: 'inst-1', email: 'inst@test.com', role: 'INSTRUCTOR', name: 'Ins' };
const STUDENT = { id: 'stu-1', email: 'stu@test.com', role: 'STUDENT', name: 'Stu' };

const COURSE = { id: 1, userId: 'owner-1', coreCourseId: 'cuid-core-course' };

/** Make the access middleware load a variant in the given state. */
function loadVariant({ isDraft, createdBy }) {
  mockVariantsFindOne.mockResolvedValue({
    id: 42,
    isDraft,
    createdBy,
    update: vi.fn(),
    questionMetadata: { type: 'SA', course: COURSE },
  });
}

/** Authenticate as `user` and enroll them on the course with `enrollRole`. */
function authAs(user, enrollRole) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }));
  mockEnrollments.mockResolvedValue({
    enrollments: enrollRole ? [{ studentId: user.id, role: enrollRole, isActive: true }] : [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteVariant.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('STUDENT is flat-gated off variant authoring (§16)', () => {
  it.each([
    ['put', '/api/questions/variants/42', { questionText: 'x' }],
    ['delete', '/api/questions/variants/42', {}],
    ['post', '/api/questions/5/variants', { questionText: 'x' }],
  ])('%s %s → 403', async (method, path, body) => {
    authAs(STUDENT, null);
    const res = await request(app)[method](path).set('Cookie', 'session=v').send(body);
    expect(res.status).toBe(403);
  });
});

describe('TA own-only edit (§19)', () => {
  it('edits own draft → 200', async () => {
    authAs(TA, 'TA');
    loadVariant({ isDraft: true, createdBy: TA.id });
    mockUpdateVariant.mockResolvedValue({ id: 42, isDraft: true, questionMetadata: { course: COURSE } });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=v')
      .send({ questionText: 'edited' });

    expect(res.status).toBe(200);
    expect(mockUpdateVariant).toHaveBeenCalled();
  });

  it("edits another user's draft → 403", async () => {
    authAs(TA, 'TA');
    loadVariant({ isDraft: true, createdBy: 'someone-else' });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=v')
      .send({ questionText: 'edited' });

    expect(res.status).toBe(403);
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it('is denied on a draft with no owner (null createdBy) → 403', async () => {
    authAs(TA, 'TA');
    loadVariant({ isDraft: true, createdBy: null });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=v')
      .send({ questionText: 'edited' });

    expect(res.status).toBe(403);
  });
});

describe('instructor-only approval (§16)', () => {
  it('TA attempting approval (isDraft:false) → 403', async () => {
    authAs(TA, 'TA');
    loadVariant({ isDraft: true, createdBy: TA.id });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=v')
      .send({ isDraft: false });

    expect(res.status).toBe(403);
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it('INSTRUCTOR approving a draft → 200', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadVariant({ isDraft: true, createdBy: 'anyone' });
    mockUpdateVariant.mockResolvedValue({ id: 42, isDraft: false, coreQuestionId: 'q', questionMetadata: { course: COURSE } });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=v')
      .send({ isDraft: false });

    expect(res.status).toBe(200);
  });
});

describe('approved-variant lock (§19)', () => {
  it('INSTRUCTOR editing an approved variant without reverting → 409', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadVariant({ isDraft: false, createdBy: 'anyone' });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=v')
      .send({ questionText: 'sneaky edit' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VARIANT_LOCKED');
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });

  it('INSTRUCTOR reverting an approved variant (isDraft:true) → 200', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadVariant({ isDraft: false, createdBy: 'anyone' });
    mockUpdateVariant.mockResolvedValue({ id: 42, isDraft: true, questionMetadata: { course: COURSE } });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=v')
      .send({ isDraft: true });

    expect(res.status).toBe(200);
    expect(mockUpdateVariant).toHaveBeenCalled();
  });

  it('TA cannot revert an approved variant → 409', async () => {
    authAs(TA, 'TA');
    loadVariant({ isDraft: false, createdBy: TA.id });

    const res = await request(app)
      .put('/api/questions/variants/42')
      .set('Cookie', 'session=v')
      .send({ isDraft: true });

    expect(res.status).toBe(409);
    expect(mockUpdateVariant).not.toHaveBeenCalled();
  });
});

describe('PATCH testable is instructor-gated (§16 push domain)', () => {
  it('TA → 403 before any payload check', async () => {
    authAs(TA, 'TA');
    loadVariant({ isDraft: false, createdBy: TA.id });

    const res = await request(app)
      .patch('/api/questions/variants/42/testable')
      .set('Cookie', 'session=v')
      .send({ testable: 'not-a-bool' });

    expect(res.status).toBe(403);
  });

  it('INSTRUCTOR with a non-boolean payload → 400', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadVariant({ isDraft: false, createdBy: 'anyone' });

    const res = await request(app)
      .patch('/api/questions/variants/42/testable')
      .set('Cookie', 'session=v')
      .send({ testable: 'not-a-bool' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });
});

describe('TA own-only delete (§19)', () => {
  it('deletes own variant → 200', async () => {
    authAs(TA, 'TA');
    loadVariant({ isDraft: true, createdBy: TA.id });

    const res = await request(app).delete('/api/questions/variants/42').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockDeleteVariant).toHaveBeenCalled();
  });

  it("deletes another user's variant → 403", async () => {
    authAs(TA, 'TA');
    loadVariant({ isDraft: true, createdBy: 'someone-else' });

    const res = await request(app).delete('/api/questions/variants/42').set('Cookie', 'session=v');

    expect(res.status).toBe(403);
    expect(mockDeleteVariant).not.toHaveBeenCalled();
  });

  it('INSTRUCTOR deletes any approved variant → 200 (no lock on delete)', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadVariant({ isDraft: false, createdBy: 'anyone' });

    const res = await request(app).delete('/api/questions/variants/42').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockDeleteVariant).toHaveBeenCalled();
  });
});
