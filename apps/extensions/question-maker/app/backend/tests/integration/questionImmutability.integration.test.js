/**
 * DB-backed tests for #1080 (#1072 §4 step 9): reviewed questions become
 * immutable. Extends the existing §19 approved-variant content lock
 * (questionText/difficulty, `variants.js`) to `type` + primary/secondary
 * topics, and verifies un-review (isDraft:true) clears `coreQuestionId` so
 * the next approval re-pushes to Core instead of skipping (state-based push
 * guard: `isDraft===false && !variant.coreQuestionId`, `variants.js:182`).
 *
 * Real DB (Question_Metadata/Variants/Topics), real routes/services. Only the
 * Core HTTP boundary (global `fetch`) is stubbed — session validation plus
 * `POST /api/questions` (the push endpoint), counted per call so a genuine
 * re-push after un-review is distinguishable from the original push being
 * skipped/reused.
 *
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_USER = { id: 'cuid-immut-user', email: 'immut@test.com', role: 'INSTRUCTOR', name: 'Immut User' };

const cookie = () => ({ Cookie: 'session=valid' });

/**
 * Stubs global fetch for: Core session validation (always) and, when
 * `withPush` is set, `POST {coreUrl}/api/questions` — each call returns a
 * distinct `id` (`core-question-1`, `core-question-2`, …) so re-push vs.
 * reused-link is observable from the response body. Exposes `.pushCalls` and
 * `.idempotencyKeys` (the `idempotencyKey` sent on each push, in call order)
 * so a genuine content-changed re-push (#1080 follow-up) can be distinguished
 * from a stale-key replay.
 */
function coreFetchStub() {
  let pushCalls = 0;
  const idempotencyKeys = [];
  const fn = vi.fn().mockImplementation((url, opts = {}) => {
    const target = String(url);
    if (target.endsWith('/api/sessions/validate')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: TEST_USER }) });
    }
    if (/\/enrollments$/.test(target.split('?')[0])) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            enrollments: [{ studentId: TEST_USER.id, role: 'INSTRUCTOR', isActive: true }],
          }),
      });
    }
    if (target.endsWith('/api/questions') && (opts.method ?? 'GET') === 'POST') {
      pushCalls += 1;
      if (typeof opts.body === 'string') {
        try {
          idempotencyKeys.push(JSON.parse(opts.body).idempotencyKey);
        } catch {
          idempotencyKeys.push(undefined);
        }
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: `core-question-${pushCalls}` }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  Object.defineProperty(fn, 'pushCalls', { get: () => pushCalls });
  Object.defineProperty(fn, 'idempotencyKeys', { get: () => idempotencyKeys });
  return fn;
}

describeDb('Reviewed questions are immutable (#1080)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let courseId, topicId, otherTopicId;
  let fetchStub;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    prisma = testDb.prisma;
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
  });

  beforeEach(async () => {
    await truncateTestDatabase();

    await prisma.user.create({ data: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name } });
    await seedCoursesForNewUser(TEST_USER.id);

    const course = await prisma.course.findFirst({ where: { userId: TEST_USER.id } });
    courseId = course.id;
    const courseTopics = await prisma.topics.findMany({ where: { courseId }, take: 2, orderBy: { id: 'asc' } });
    topicId = courseTopics[0].id;
    otherTopicId = courseTopics[1].id;
    // Pre-link both topics to Core so pushVariantToCore's resolveCoreTopicId
    // skips the (separately-mocked) topic-push call and uses these directly.
    await prisma.topics.update({ where: { id: topicId }, data: { coreTopicId: 'core-topic-primary' } });
    await prisma.topics.update({ where: { id: otherTopicId }, data: { coreTopicId: 'core-topic-secondary' } });

    fetchStub = coreFetchStub();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  /** Creates a question + draft variant, then approves the variant (triggering the first Core push). */
  async function createApprovedQuestion() {
    const createQ = await request(app)
      .post('/api/questions')
      .set(cookie())
      .send({ description: 'Immutability fixture', courseId, primaryTopicId: topicId, type: 'MCQ' });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    const createV = await request(app)
      .post(`/api/questions/${qid}/variants`)
      .set(cookie())
      .send({
        questionText: 'What is 2+2?',
        difficulty: 'easy',
        reasoningLevel: 'factual',
        answer: 'A',
        choices: [{ letter: 'A', text: '4' }, { letter: 'B', text: '5' }],
        isDraft: true,
      });
    expect(createV.status).toBe(201);
    const vid = createV.body.data.id;

    const approve = await request(app)
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false });
    expect(approve.status).toBe(200);
    expect(approve.body.data.coreQuestionId).toBe('core-question-1');

    return { qid, vid };
  }

  it('rejects a type change on a reviewed question (409 VARIANT_LOCKED)', async () => {
    const { qid } = await createApprovedQuestion();

    const res = await request(app).put(`/api/questions/${qid}`).set(cookie()).send({ type: 'SA' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VARIANT_LOCKED');
  });

  it('rejects a primary topic change on a reviewed question (409 VARIANT_LOCKED)', async () => {
    const { qid } = await createApprovedQuestion();

    const res = await request(app)
      .put(`/api/questions/${qid}`)
      .set(cookie())
      .send({ primaryTopicId: otherTopicId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VARIANT_LOCKED');
  });

  it('rejects a secondary topics change on a reviewed variant (409 VARIANT_LOCKED, regression)', async () => {
    const { vid } = await createApprovedQuestion();

    const res = await request(app)
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ secondaryTopicsId: [otherTopicId] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VARIANT_LOCKED');
  });

  it('unrelated edits (e.g. description) still succeed on a reviewed question', async () => {
    const { qid } = await createApprovedQuestion();

    const res = await request(app)
      .put(`/api/questions/${qid}`)
      .set(cookie())
      .send({ description: 'Updated description only' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated description only');
  });

  it('un-review clears coreQuestionId, and a re-approve re-pushes a fresh copy', async () => {
    const { qid, vid } = await createApprovedQuestion();

    // Un-review (instructor-only revert per §19/§16) clears the Core link (#1080).
    const revert = await request(app)
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: true });
    expect(revert.status).toBe(200);
    expect(revert.body.data.isDraft).toBe(true);
    expect(revert.body.data.coreQuestionId).toBeNull();

    // Now unlocked: the primary topic can change while the variant is a draft.
    const editTopic = await request(app)
      .put(`/api/questions/${qid}`)
      .set(cookie())
      .send({ primaryTopicId: otherTopicId });
    expect(editTopic.status).toBe(200);
    expect(editTopic.body.data.primaryTopicId).toBe(otherTopicId);

    // Re-approve: the state-based push guard (`!variant.coreQuestionId`) must
    // fire again now that the link was cleared, instead of treating the
    // variant as already-linked and skipping the push.
    const reapprove = await request(app)
      .put(`/api/questions/variants/${vid}`)
      .set(cookie())
      .send({ isDraft: false });
    expect(reapprove.status).toBe(200);
    expect(reapprove.body.data.coreQuestionId).toBe('core-question-2');

    // #1080 follow-up: the two pushes must have used different idempotency
    // keys (content-derived, not a bare `qm-variant-<id>`) — otherwise Core's
    // idempotencyKey lookup would have returned the stale pre-edit row instead
    // of creating `core-question-2`.
    expect(fetchStub.pushCalls).toBe(2);
    expect(fetchStub.idempotencyKeys).toHaveLength(2);
    expect(fetchStub.idempotencyKeys[0]).not.toBe(fetchStub.idempotencyKeys[1]);
    expect(fetchStub.idempotencyKeys[0]).toMatch(/^qm-variant-\d+-[0-9a-f]{12}$/);
    expect(fetchStub.idempotencyKeys[1]).toMatch(/^qm-variant-\d+-[0-9a-f]{12}$/);
  });
});
