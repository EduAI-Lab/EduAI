/**
 * DB-backed integration tests for QM → Core wiring routes.
 *
 * Requires TEST_DATABASE_URL to be set (see .env). All auth is handled by
 * stubbing global fetch to return a fixed Core user for session validation.
 * Outbound Core API calls (topics, questions) are also stubbed via fetch.
 * Test data is seeded directly through Sequelize models — no register/login endpoint.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';

// findOrCreateUser is called by requireAuth after session validate succeeds.
// Mock it so we don't need a running Core for user row upserts.
vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

// The user seeded in beforeEach — matches what fetch mock returns.
const TEST_USER = { id: 'cuid-test-user', email: 'test@test.com', role: 'INSTRUCTOR', name: 'Test Instructor' };

// Returns a fetch stub that:
//  - answers session/validate with TEST_USER
//  - answers any further calls with the provided mocks in order
function makeFetch(...extraMocks) {
  const sessionReply = { ok: true, json: () => Promise.resolve({ user: TEST_USER }) };
  return vi.fn()
    .mockResolvedValueOnce(sessionReply)
    .mockImplementation(() => {
      const next = extraMocks.shift();
      return next
        ? Promise.resolve(next)
        : Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
}

function coreOk(data, status = 200) {
  return { ok: true, status, json: () => Promise.resolve(data) };
}
function coreErr(data, status) {
  return { ok: false, status, json: () => Promise.resolve(data) };
}

describeDb('Core wiring DB integration', () => {
  let connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course, Topics, Question_Metadata, Variants;
  let courseId, topicId, questionId, variantId;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    sequelize = testDb.sequelize;
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, Question_Metadata, Variants } = schema);
  });

  beforeEach(async () => {
    await truncateTestDatabase();

    // Seed user (mirrors what requireAuth puts in req.user)
    await User.create({ id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name });

    // Seed a course (not yet linked to Core)
    const course = await Course.create({ userId: TEST_USER.id, name: 'Test Course' });
    courseId = course.id;

    // Seed a topic
    const topic = await Topics.create({ courseId, name: 'Chapter 1' });
    topicId = topic.id;

    // Seed a question + draft variant
    const q = await Question_Metadata.create({ courseId, primaryTopicId: topicId, type: 'SA' });
    questionId = q.id;

    const v = await Variants.create({
      questionMetadataId: questionId,
      questionText: 'What is sorting?',
      isDraft: true,
    });
    variantId = v.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  const cookie = () => ({ Cookie: 'session=valid' });

  // ---------------------------------------------------------------------------
  // PATCH /api/course/:id/link-core
  // ---------------------------------------------------------------------------
  describe('PATCH /api/course/:id/link-core', () => {
    it('stores coreCourseId on the course', async () => {
      vi.stubGlobal('fetch', makeFetch());

      const res = await request(app)
        .patch(`/api/course/${courseId}/link-core`)
        .set(cookie())
        .send({ coreCourseId: 'cuid-core-course' });

      expect(res.status).toBe(200);
      expect(res.body.data.coreCourseId).toBe('cuid-core-course');

      const updated = await Course.findByPk(courseId);
      expect(updated.coreCourseId).toBe('cuid-core-course');
    });

    it('returns 404 for a course the user does not own', async () => {
      vi.stubGlobal('fetch', makeFetch());

      const res = await request(app)
        .patch('/api/course/99999/link-core')
        .set(cookie())
        .send({ coreCourseId: 'cuid-core-course' });

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/course/:id/sync-topics
  // ---------------------------------------------------------------------------
  describe('POST /api/course/:id/sync-topics', () => {
    it('returns 400 when course is not linked to Core', async () => {
      vi.stubGlobal('fetch', makeFetch());

      const res = await request(app)
        .post(`/api/course/${courseId}/sync-topics`)
        .set(cookie());

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not linked/i);
    });

    it('upserts new Core topics and links existing ones by name', async () => {
      await Course.update({ coreCourseId: 'cuid-core-course' }, { where: { id: courseId } });

      const coreTopics = [
        { id: 'cuid-t1', name: 'Chapter 1' }, // matches existing local topic by name
        { id: 'cuid-t2', name: 'Chapter 2' }, // new
      ];
      vi.stubGlobal('fetch', makeFetch(coreOk({ topics: coreTopics })));

      const res = await request(app)
        .post(`/api/course/${courseId}/sync-topics`)
        .set(cookie());

      expect(res.status).toBe(200);
      expect(res.body.data.synced).toBe(2);

      const ch1 = await Topics.findOne({ where: { courseId, name: 'Chapter 1' } });
      expect(ch1.coreTopicId).toBe('cuid-t1');

      const ch2 = await Topics.findOne({ where: { courseId, name: 'Chapter 2' } });
      expect(ch2.coreTopicId).toBe('cuid-t2');
    });

    it('returns 502 when Core fetch fails', async () => {
      await Course.update({ coreCourseId: 'cuid-core-course' }, { where: { id: courseId } });

      vi.stubGlobal('fetch', makeFetch(coreErr({ error: 'Service Unavailable' }, 503)));

      const res = await request(app)
        .post(`/api/course/${courseId}/sync-topics`)
        .set(cookie());

      expect(res.status).toBe(502);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/course/:id/topics — Core push on creation
  // ---------------------------------------------------------------------------
  describe('POST /api/course/:id/topics — Core push', () => {
    it('pushes to Core and stores coreTopicId when course is linked', async () => {
      await Course.update({ coreCourseId: 'cuid-core-course' }, { where: { id: courseId } });

      // fetch: session validate, then Core POST /topics
      vi.stubGlobal('fetch', makeFetch(coreOk({ id: 'cuid-new-topic', name: 'Sorting' }, 201)));

      const res = await request(app)
        .post(`/api/course/${courseId}/topics`)
        .set(cookie())
        .send({ name: 'Sorting' });

      expect(res.status).toBe(201);
      expect(res.body.data.coreTopicId).toBe('cuid-new-topic');

      const stored = await Topics.findOne({ where: { courseId, name: 'Sorting' } });
      expect(stored.coreTopicId).toBe('cuid-new-topic');
    });

    it('creates topic locally even when Core push fails', async () => {
      await Course.update({ coreCourseId: 'cuid-core-course' }, { where: { id: courseId } });

      vi.stubGlobal('fetch', makeFetch({ ok: false, status: 503, json: () => Promise.resolve({}) }));

      const res = await request(app)
        .post(`/api/course/${courseId}/topics`)
        .set(cookie())
        .send({ name: 'Fallback Topic' });

      expect(res.status).toBe(201);
      expect(res.body.data.coreTopicId).toBeNull();

      const stored = await Topics.findOne({ where: { courseId, name: 'Fallback Topic' } });
      expect(stored).not.toBeNull();
      expect(stored.coreTopicId).toBeNull();
    });

    it('uses existingId when Core returns 409', async () => {
      await Course.update({ coreCourseId: 'cuid-core-course' }, { where: { id: courseId } });

      vi.stubGlobal(
        'fetch',
        makeFetch({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: 'TOPIC_ALREADY_EXISTS', existingId: 'cuid-existing-topic' }),
        }),
      );

      // Use a name that doesn't already exist locally so Topics.create succeeds
      const res = await request(app)
        .post(`/api/course/${courseId}/topics`)
        .set(cookie())
        .send({ name: 'Sorting Algorithms' });

      expect(res.status).toBe(201);
      expect(res.body.data.coreTopicId).toBe('cuid-existing-topic');
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/questions/variants/:variantId/testable
  // ---------------------------------------------------------------------------
  describe('PATCH /api/questions/variants/:variantId/testable', () => {
    it('returns 400 when variant has no coreQuestionId', async () => {
      vi.stubGlobal('fetch', makeFetch());

      const res = await request(app)
        .patch(`/api/questions/variants/${variantId}/testable`)
        .set(cookie())
        .send({ testable: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Core/i);
    });

    it('nulls coreQuestionId and returns 404 on Core QUESTION_NOT_FOUND', async () => {
      await Variants.update({ coreQuestionId: 'cuid-core-q' }, { where: { id: variantId } });

      vi.stubGlobal('fetch', makeFetch(coreErr({ error: 'QUESTION_NOT_FOUND' }, 404)));

      const res = await request(app)
        .patch(`/api/questions/variants/${variantId}/testable`)
        .set(cookie())
        .send({ testable: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('QUESTION_NOT_FOUND');

      const updated = await Variants.findByPk(variantId);
      expect(updated.coreQuestionId).toBeNull();
    });

    it('returns { id, testable } on Core success', async () => {
      await Variants.update({ coreQuestionId: 'cuid-core-q' }, { where: { id: variantId } });

      vi.stubGlobal('fetch', makeFetch(coreOk({ id: 'cuid-core-q', testable: true })));

      const res = await request(app)
        .patch(`/api/questions/variants/${variantId}/testable`)
        .set(cookie())
        .send({ testable: true });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: 'cuid-core-q', testable: true });
    });
  });
});
