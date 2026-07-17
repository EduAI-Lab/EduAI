/**
 * Integration tests for question banks (proxied to EduAI Core) and Canvas bank sync.
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md.
 *
 * EduAI Core is mocked in-memory so banks live “in Core” without a running Core instance.
 * Canvas re-sync push is mocked via coreWiringService.pushVariantToCore.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const SEED_CODES = [
  'COSC 211',
  'COSC 121',
  'STUDY1',
  'STUDY3',
  'STUDY2',
  'STUDY4',
  'STUDY5'
];

const normalizeCode = (value) =>
  value == null ? '' : String(value).replace(/\s+/g, '').toLowerCase();

/** @type {Map<string, Array<object>>} */
const banksByCourse = new Map();
/** @type {Map<string, Array<object>>} */
const membershipsByBank = new Map();
let bankSeq = 0;
let membershipSeq = 0;

const { mockPushVariantToCore } = vi.hoisted(() => ({
  mockPushVariantToCore: vi.fn()
}));

function coreCourseIdForCode(code) {
  return `core_${normalizeCode(code)}`;
}

function ensureDefaultBank(coreCourseId) {
  let banks = banksByCourse.get(coreCourseId);
  if (!banks) {
    banks = [];
    banksByCourse.set(coreCourseId, banks);
  }
  let def = banks.find((b) => b.isDefault);
  if (!def) {
    def = {
      id: `bank_default_${++bankSeq}`,
      courseId: coreCourseId,
      name: 'Course bank',
      description: null,
      isDefault: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    banks.push(def);
  }
  return def;
}

function coreMembershipsForBank(bankId) {
  return membershipsByBank.get(String(bankId)) || [];
}

vi.mock('../../src/services/coreWiringService.js', () => ({
  pushVariantToCore: (...args) => mockPushVariantToCore(...args)
}));

vi.mock('../../src/services/eduaiService.js', () => ({
  default: {
    isConfigured: () => true,
    listCourses: async () =>
      SEED_CODES.map((code) => ({
        id: coreCourseIdForCode(code),
        code,
        name: code
      })),
    listQuestionBanks: async (coreCourseId) => {
      ensureDefaultBank(coreCourseId);
      return { banks: banksByCourse.get(coreCourseId) || [] };
    },
    createQuestionBank: async (coreCourseId, payload) => {
      ensureDefaultBank(coreCourseId);
      const bank = {
        id: `bank_${++bankSeq}`,
        courseId: coreCourseId,
        name: String(payload.name).trim(),
        description: payload.description ?? null,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      banksByCourse.get(coreCourseId).push(bank);
      return bank;
    },
    updateQuestionBank: async (coreCourseId, bankId, payload) => {
      const banks = banksByCourse.get(coreCourseId) || [];
      const bank = banks.find((b) => b.id === bankId);
      if (!bank) {
        const err = new Error('Question bank not found');
        err.response = { status: 404, data: { error: 'Question bank not found' } };
        throw err;
      }
      if (payload.name !== undefined) bank.name = String(payload.name).trim();
      if (payload.description !== undefined) bank.description = payload.description;
      bank.updatedAt = new Date().toISOString();
      return bank;
    },
    deleteQuestionBank: async (coreCourseId, bankId) => {
      const banks = banksByCourse.get(coreCourseId) || [];
      const bank = banks.find((b) => b.id === bankId);
      if (!bank) {
        const err = new Error('Question bank not found');
        err.response = { status: 404, data: { error: 'Question bank not found' } };
        throw err;
      }
      if (bank.isDefault) {
        const err = new Error('Cannot delete the default question bank');
        err.status = 400;
        throw err;
      }
      banksByCourse.set(
        coreCourseId,
        banks.filter((b) => b.id !== bankId)
      );
      membershipsByBank.delete(bankId);
      return { success: true };
    },
    listQuestionBankMemberships: async (_coreCourseId, bankId) => ({
      memberships: membershipsByBank.get(bankId) || []
    }),
    addQuestionBankMembership: async (_coreCourseId, bankId, payload) => {
      const list = membershipsByBank.get(bankId) || [];
      const existing = list.find((m) => m.questionId === payload.questionId);
      if (existing) return existing;
      const membership = {
        id: `mem_${++membershipSeq}`,
        questionBankId: bankId,
        questionId: payload.questionId,
        createdAt: new Date().toISOString()
      };
      list.push(membership);
      membershipsByBank.set(bankId, list);
      return membership;
    },
    removeQuestionBankMembership: async (_coreCourseId, bankId, questionId) => {
      const list = membershipsByBank.get(bankId) || [];
      membershipsByBank.set(
        bankId,
        list.filter((m) => m.questionId !== questionId)
      );
      return { removed: true };
    }
  }
}));

describeDb('Question banks + Canvas bank sync (integration)', () => {
  let app;
  let truncateTestDatabase;
  let connectTestDatabase;
  let sequelize;
  let authToken;
  let courseId;
  let topicId;
  let Variants;
  let Course;
  let CanvasBankQuestionMapping;

  async function seedApprovedVariant(questionMetadataId, coreQuestionId) {
    let variant = await Variants.findOne({ where: { questionMetadataId } });
    if (variant) {
      await variant.update({ coreQuestionId, isDraft: false });
      return variant;
    }
    return Variants.create({
      questionMetadataId,
      questionText: 'Test question',
      difficulty: 'medium',
      coreQuestionId,
      isDraft: false,
      isAiGenerated: false
    });
  }

  beforeAll(async () => {
    if (!hasTestDb) return;
    const { default: appMod } = await import('../../src/app.js');
    const testDb = await import('../helpers/testDb.js');
    const schema = await import('../../src/schema/index.js');
    Variants = schema.Variants;
    Course = schema.Course;
    CanvasBankQuestionMapping = schema.CanvasBankQuestionMapping;
    app = appMod;
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    ({ sequelize } = testDb);
    await connectTestDatabase();
  }, 60000);

  beforeEach(async () => {
    if (!hasTestDb) return;
    banksByCourse.clear();
    membershipsByBank.clear();
    bankSeq = 0;
    membershipSeq = 0;
    mockPushVariantToCore.mockReset();
    mockPushVariantToCore.mockImplementation(async (variant) => ({
      coreQuestionId: `core_canvas_${variant.id}`
    }));
    await truncateTestDatabase();

    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        email: `banks-${Date.now()}@local.test`,
        password: 'secret12'
      });
    expect(reg.status).toBe(201);
    authToken = reg.body.data.token;

    const coursesRes = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${authToken}`);
    courseId = coursesRes.body.data[0].id;

    const topicsRes = await request(app)
      .get(`/api/course/${courseId}/topics`)
      .set('Authorization', `Bearer ${authToken}`);
    topicId = topicsRes.body.data[0].id;
  });

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  it('lists a default bank for a seeded course', async () => {
    const res = await request(app)
      .get(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((b) => b.isDefault)).toBe(true);
    expect(typeof res.body.data[0].id).toBe('string');
  });

  it('does not Core-member a new question until coreQuestionId exists', async () => {
    const banksRes = await request(app)
      .get(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`);
    const defaultBank = banksRes.body.data.find((b) => b.isDefault);

    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Unapproved question',
        courseId,
        primaryTopicId: topicId,
        type: 'SA'
      });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    expect(coreMembershipsForBank(defaultBank.id)).toHaveLength(0);

    const add = await request(app)
      .post(`/api/course/${courseId}/banks/${defaultBank.id}/questions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ questionMetadataId: qid });
    expect(add.status).toBe(409);
    expect(coreMembershipsForBank(defaultBank.id)).toHaveLength(0);

    const bankList = await request(app)
      .get('/api/questions')
      .query({ courseId, questionBankId: defaultBank.id })
      .set('Authorization', `Bearer ${authToken}`);
    expect(bankList.body.data.some((q) => q.id === qid)).toBe(false);
  });

  it('supports multi-bank membership for the same question via Core questionId', async () => {
    const banksRes = await request(app)
      .get(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`);
    const defaultBank = banksRes.body.data.find((b) => b.isDefault);

    const createBank = await request(app)
      .post(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Extra bank' });
    expect(createBank.status).toBe(201);
    const extraBankId = createBank.body.data.id;
    expect(typeof extraBankId).toBe('string');

    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Shared question',
        courseId,
        primaryTopicId: topicId,
        type: 'SA'
      });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;
    const coreQuestionId = `core_q_${qid}`;
    await seedApprovedVariant(qid, coreQuestionId);

    const addDefault = await request(app)
      .post(`/api/course/${courseId}/banks/${defaultBank.id}/questions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ questionMetadataId: qid });
    expect([200, 201]).toContain(addDefault.status);

    const add = await request(app)
      .post(`/api/course/${courseId}/banks/${extraBankId}/questions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ questionMetadataId: qid });
    expect([200, 201]).toContain(add.status);

    const defaultMembers = coreMembershipsForBank(defaultBank.id);
    const extraMembers = coreMembershipsForBank(extraBankId);
    expect(defaultMembers.every((m) => m.questionId === coreQuestionId)).toBe(true);
    expect(extraMembers.every((m) => m.questionId === coreQuestionId)).toBe(true);

    const inDefault = await request(app)
      .get('/api/questions')
      .query({ courseId, questionBankId: defaultBank.id })
      .set('Authorization', `Bearer ${authToken}`);
    const inExtra = await request(app)
      .get('/api/questions')
      .query({ courseId, questionBankId: extraBankId })
      .set('Authorization', `Bearer ${authToken}`);

    expect(inDefault.body.data.some((q) => q.id === qid)).toBe(true);
    expect(inExtra.body.data.some((q) => q.id === qid)).toBe(true);

    const courseWide = await request(app)
      .get('/api/questions')
      .query({ courseId })
      .set('Authorization', `Bearer ${authToken}`);
    const matches = courseWide.body.data.filter((q) => q.id === qid);
    expect(matches.length).toBe(1);
  });

  it('cannot delete the default bank', async () => {
    const banksRes = await request(app)
      .get(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`);
    const defaultBank = banksRes.body.data.find((b) => b.isDefault);

    const del = await request(app)
      .delete(`/api/course/${courseId}/banks/${defaultBank.id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(del.status).toBe(400);
  });

  it('returns 409 when adding an unapproved question to a bank', async () => {
    const banksRes = await request(app)
      .get(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`);
    const defaultBank = banksRes.body.data.find((b) => b.isDefault);

    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Pending question',
        courseId,
        primaryTopicId: topicId,
        type: 'SA'
      });
    expect(createQ.status).toBe(201);

    const add = await request(app)
      .post(`/api/course/${courseId}/banks/${defaultBank.id}/questions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ questionMetadataId: createQ.body.data.id });
    expect(add.status).toBe(409);
  });

  it('Canvas first import creates pending mappings without Core membership; re-sync pushes then members', async () => {
    await Course.update(
      { coreCourseId: coreCourseIdForCode('COSC 211') },
      { where: { id: courseId } }
    );

    await request(app)
      .post('/api/canvas/connect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        canvasUrl: 'https://canvas.test',
        isTestMode: true
      });

    const first = await request(app)
      .post('/api/canvas/import/1/banks/10')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ localCourseId: courseId, primaryTopicId: topicId });
    expect(first.status).toBe(200);
    expect(first.body.data.created).toBeGreaterThan(0);
    const bankId = first.body.data.bankId;
    expect(typeof bankId).toBe('string');
    const created = first.body.data.created;

    expect(coreMembershipsForBank(bankId)).toHaveLength(0);
    expect(mockPushVariantToCore).not.toHaveBeenCalled();

    const mappings = await CanvasBankQuestionMapping.findAll({
      where: { localBankId: String(bankId) }
    });
    expect(mappings.length).toBe(created);

    const pendingList = await request(app)
      .get('/api/questions')
      .query({ courseId, questionBankId: bankId })
      .set('Authorization', `Bearer ${authToken}`);
    expect(pendingList.body.data.length).toBe(created);

    const second = await request(app)
      .post('/api/canvas/import/1/banks/10')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Cookie', 'session=test-integration')
      .send({ localCourseId: courseId, primaryTopicId: topicId, targetBankId: bankId });
    expect(second.status).toBe(200);
    expect(second.body.data.created).toBe(0);
    expect(second.body.data.updated).toBe(created);
    expect(mockPushVariantToCore.mock.calls.length).toBe(created);

    const members = coreMembershipsForBank(bankId);
    expect(members.length).toBe(created);
    expect(members.every((m) => typeof m.questionId === 'string' && m.questionId.startsWith('core_canvas_'))).toBe(
      true
    );

    const memberList = await request(app)
      .get('/api/questions')
      .query({ courseId, questionBankId: bankId })
      .set('Authorization', `Bearer ${authToken}`);
    expect(memberList.body.data.length).toBe(created);
  });
});
