/**
 * DB-backed tests for the pagination contract across QM's list endpoints (#1044).
 *
 * Complements the pure-function coverage in `tests/unit/pagination.test.js` by
 * exercising the parts only a real database and a real request can show:
 *   - page boundaries: first / middle / last-partial page, no overlap, no gaps
 *   - empty pages: an offset past the end returns `[]` with the true `total`
 *   - auth: an unauthenticated caller is rejected before any paging happens
 *   - bounded responses: an unpaged caller gets a page, never the whole set
 *   - total ordering: rows tied on the sort key don't repeat or vanish across
 *     pages (the `id` tiebreak on questions-in-assessment and variants)
 *   - large exports: a bank bigger than one export batch exports completely
 *
 * Auth is handled by stubbing global fetch for Core session validation; data is
 * seeded directly via Sequelize models. Requires TEST_DATABASE_URL — see
 * docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_USER = { id: 'cuid-pagination-user', email: 'paging@test.com', role: 'INSTRUCTOR', name: 'Paging User' };

const cookie = () => ({ Cookie: 'session=valid' });

function sessionFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ user: TEST_USER }),
  });
}

/**
 * Swap the session stub for one where Core rejects the session.
 *
 * The suite-wide `sessionFetch` stub validates *any* request, cookie or not, so
 * simply omitting the cookie would still authenticate and prove nothing. Making
 * Core say no is the honest way to assert these routes reject before paging.
 */
function stubRejectedSession() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }),
  );
}

describeDb('Pagination contract (integration)', () => {
  let truncateTestDatabase, sequelize;
  let User, Course, Topics, Question_Metadata, Variants, Assessments;
  let seedCoursesForNewUser;
  let courseId, topicId;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    sequelize = testDb.sequelize;
    truncateTestDatabase = testDb.truncateTestDatabase;
    await testDb.connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, Question_Metadata, Variants, Assessments } = schema);
    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
  });

  beforeEach(async () => {
    await truncateTestDatabase();

    await User.create({ id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name });
    await seedCoursesForNewUser(TEST_USER.id);

    const course = await Course.findOne({ where: { userId: TEST_USER.id } });
    courseId = course.id;
    const topic = await Topics.findOne({ where: { courseId } });
    topicId = topic.id;

    vi.stubGlobal('fetch', sessionFetch());
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  /**
   * Creates `count` topics on the seeded course, all sharing one `createdAt` so
   * the non-unique sort key is genuinely tied — a bulkCreate is how topic sync
   * writes a whole Core set, and it's the case the `id` tiebreak exists for.
   */
  async function seedTiedTopics(count) {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const rows = Array.from({ length: count }, (_, i) => ({
      name: `Tied Topic ${String(i).padStart(3, '0')}`,
      courseId,
      createdAt,
      updatedAt: createdAt,
    }));
    return Topics.bulkCreate(rows, { returning: true });
  }

  /** Creates `count` questions on the seeded course, all sharing one timestamp. */
  async function seedQuestions(count) {
    const createdAt = new Date('2026-02-01T00:00:00.000Z');
    const rows = Array.from({ length: count }, (_, i) => ({
      description: `Paged question ${String(i).padStart(4, '0')}`,
      courseId,
      primaryTopicId: topicId,
      type: 'MCQ',
      createdAt,
      updatedAt: createdAt,
    }));
    return Question_Metadata.bulkCreate(rows, { returning: true });
  }

  /** Walks every page of an endpoint the way the frontend's `fetchAllPages` does. */
  async function walkPages(path, pageSize) {
    const seen = [];
    const pages = [];
    for (let page = 1; page <= 100; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const res = await request(app)
        .get(`${path}${sep}page=${page}&pageSize=${pageSize}`)
        .set(cookie());
      expect(res.status).toBe(200);
      pages.push(res.body);
      seen.push(...res.body.data);
      if (res.body.data.length === 0 || res.body.data.length < pageSize) break;
      if (seen.length >= res.body.total) break;
    }
    return { rows: seen, pages };
  }

  describe('GET /api/course/:id/topics — page boundaries', () => {
    it('walks first/middle/last pages with no overlap and no gaps', async () => {
      // 25 rows at pageSize 10 => pages of 10, 10, 5 (a partial last page).
      await seedTiedTopics(25 - (await Topics.count({ where: { courseId } })));
      const total = await Topics.count({ where: { courseId } });
      expect(total).toBe(25);

      const { rows, pages } = await walkPages(`/api/course/${courseId}/topics`, 10);

      expect(pages.map((p) => p.data.length)).toEqual([10, 10, 5]);
      pages.forEach((p) => expect(p.total).toBe(25));
      expect(rows).toHaveLength(25);

      // Every row seen exactly once — the property the `id` tiebreak protects.
      const ids = rows.map((t) => t.id);
      expect(new Set(ids).size).toBe(25);
    });

    it('returns an empty page past the end, still reporting the true total', async () => {
      const total = await Topics.count({ where: { courseId } });

      const res = await request(app)
        .get(`/api/course/${courseId}/topics?page=500&pageSize=10`)
        .set(cookie());

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(total);
      expect(res.body.page).toBe(500);
      expect(res.body.pageSize).toBe(10);
    });

    it('bounds an unpaged caller to a page instead of the whole set', async () => {
      // The regression this PR's review asked for: no params must not mean
      // "every row". 12 rows at a forced pageSize of 5 proves the cap applies.
      await seedTiedTopics(12 - (await Topics.count({ where: { courseId } })));

      const capped = await request(app)
        .get(`/api/course/${courseId}/topics?pageSize=5`)
        .set(cookie());

      // pageSize-only is honoured in default mode; page defaults to 1.
      expect(capped.status).toBe(200);
      expect(capped.body.page).toBe(1);
      expect(capped.body.pageSize).toBe(5);
      expect(capped.body.data).toHaveLength(5);
      expect(capped.body.total).toBe(12);

      // And with no params at all the response is still a bounded envelope.
      const bare = await request(app).get(`/api/course/${courseId}/topics`).set(cookie());
      expect(bare.status).toBe(200);
      expect(typeof bare.body.pageSize).toBe('number');
      expect(bare.body.pageSize).toBeLessThanOrEqual(200);
      expect(bare.body.data.length).toBeLessThanOrEqual(bare.body.pageSize);
    });

    it('rejects an unauthenticated caller before paging', async () => {
      stubRejectedSession();
      const res = await request(app)
        .get(`/api/course/${courseId}/topics?page=1&pageSize=10`)
        .set(cookie());
      expect([401, 403]).toContain(res.status);
      expect(res.body.data).toBeUndefined();
    });
  });

  describe('GET /api/course — required params', () => {
    it('400s with PAGINATION_REQUIRED when params are missing', async () => {
      const res = await request(app).get('/api/course').set(cookie());
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PAGINATION_REQUIRED');
      expect(res.body.success).toBe(false);
    });

    it('400s with PAGINATION_REQUIRED when only page is supplied', async () => {
      const res = await request(app).get('/api/course?page=1').set(cookie());
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PAGINATION_REQUIRED');
    });

    it('400s with PAGINATION_REQUIRED when only pageSize is supplied', async () => {
      const res = await request(app).get('/api/course?pageSize=10').set(cookie());
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PAGINATION_REQUIRED');
    });

    it('400s with PAGINATION_INVALID for non-numeric params', async () => {
      const res = await request(app).get('/api/course?page=abc&pageSize=10').set(cookie());
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PAGINATION_INVALID');
    });

    it('rejects an unauthenticated caller rather than 400-ing on paging', async () => {
      // Auth must run first: a rejected session gets 401, not the
      // PAGINATION_REQUIRED 400 that a missing-params call would otherwise get.
      stubRejectedSession();
      const res = await request(app).get('/api/course').set(cookie());
      expect([401, 403]).toContain(res.status);
      expect(res.body.code).not.toBe('PAGINATION_REQUIRED');
    });

    it('returns an empty page past the end with the true total', async () => {
      const res = await request(app).get('/api/course?page=999&pageSize=25').set(cookie());
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(typeof res.body.total).toBe('number');
    });
  });

  describe('GET /api/questions/:id/variants — total ordering under ties', () => {
    it('pages tied-createdAt variants without repeats or drops', async () => {
      const [question] = await seedQuestions(1);

      // One timestamp for all 7 variants — bank generation inserts a question's
      // variants in a single statement, so `createdAt` alone is not a total order.
      const createdAt = new Date('2026-03-01T00:00:00.000Z');
      await Variants.bulkCreate(
        Array.from({ length: 7 }, (_, i) => ({
          questionMetadataId: question.id,
          questionText: `Variant ${i}`,
          difficulty: 'easy',
          createdAt,
          updatedAt: createdAt,
        })),
      );

      const { rows, pages } = await walkPages(`/api/questions/${question.id}/variants`, 2);

      expect(pages[0].total).toBe(7);
      expect(rows).toHaveLength(7);
      // The tiebreak's whole purpose: 7 distinct rows across 4 pages.
      expect(new Set(rows.map((v) => v.id)).size).toBe(7);
      // And the order is the stable ascending-id one.
      const ids = rows.map((v) => v.id);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    });

    it('bounds an unpaged variants read to a page', async () => {
      const [question] = await seedQuestions(1);
      const createdAt = new Date('2026-03-02T00:00:00.000Z');
      await Variants.bulkCreate(
        Array.from({ length: 4 }, (_, i) => ({
          questionMetadataId: question.id,
          questionText: `V${i}`,
          difficulty: 'easy',
          createdAt,
          updatedAt: createdAt,
        })),
      );

      const res = await request(app)
        .get(`/api/questions/${question.id}/variants?pageSize=2`)
        .set(cookie());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(4);
    });

    it('rejects an unauthenticated variants read', async () => {
      const [question] = await seedQuestions(1);
      stubRejectedSession();
      const res = await request(app)
        .get(`/api/questions/${question.id}/variants?page=1&pageSize=2`)
        .set(cookie());
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /api/assessments/:id/questions — total ordering under ties', () => {
    it('pages questions tied on display order without repeats or drops', async () => {
      const assessment = await Assessments.create({
        type: 'Quiz',
        name: 'Tie Ordering Exam',
        semester: 'Fall 2026',
        courseId,
      });

      // Every question claims display order 1 in this assessment, so the JSON
      // sort key is fully tied and only `id` can break it. Each also needs a
      // variant scoped to the assessment: the service's `variants` include
      // carries a `where` on assessmentId, making it an inner join, so a
      // question with no variant for this assessment wouldn't be returned.
      const questions = await seedQuestions(6);
      const createdAt = new Date('2026-04-01T00:00:00.000Z');
      await Promise.all(
        questions.map((q) =>
          q.update({ questionOrder: { [String(assessment.id)]: 1 } }),
        ),
      );
      await Variants.bulkCreate(
        questions.map((q, i) => ({
          questionMetadataId: q.id,
          assessmentId: assessment.id,
          questionText: `Assessment variant ${i}`,
          difficulty: 'easy',
          createdAt,
          updatedAt: createdAt,
        })),
      );

      const { rows, pages } = await walkPages(
        `/api/assessments/${assessment.id}/questions`,
        2,
      );

      expect(pages[0].total).toBe(6);
      expect(rows).toHaveLength(6);
      expect(new Set(rows.map((q) => q.id)).size).toBe(6);
      const ids = rows.map((q) => q.id);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    });

    it('rejects an unauthenticated assessment-questions read', async () => {
      const assessment = await Assessments.create({
        type: 'Quiz',
        name: 'Auth Exam',
        semester: 'Fall 2026',
        courseId,
      });
      stubRejectedSession();
      const res = await request(app)
        .get(`/api/assessments/${assessment.id}/questions?page=1&pageSize=2`)
        .set(cookie());
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /api/assessments/:id/sections — bounded', () => {
    it('returns a bounded envelope with a true total', async () => {
      const assessment = await Assessments.create({
        type: 'Quiz',
        name: 'Sections Exam',
        semester: 'Fall 2026',
        courseId,
      });

      const res = await request(app)
        .get(`/api/assessments/${assessment.id}/sections?page=1&pageSize=5`)
        .set(cookie());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toMatchObject({ success: true, page: 1, pageSize: 5 });
      expect(typeof res.body.total).toBe('number');
    });
  });

  describe('GET /api/questions/export — large bank', () => {
    it('exports every row when the bank exceeds one export batch', async () => {
      // The export scan batches at 500 rows and stops on the first short page.
      // 501 rows is the smallest bank that needs a second batch, so it catches
      // both an off-by-one in the stop condition and a premature break.
      // Top up to 501 over whatever the course fixture already seeded, so the
      // expected count is the DB's real count rather than a hardcoded guess.
      const seeded = await Question_Metadata.count({ where: { courseId } });
      await seedQuestions(501 - seeded);
      const expected = await Question_Metadata.count({ where: { courseId } });
      expect(expected).toBe(501);

      const res = await request(app)
        .get(`/api/questions/export?courseId=${courseId}&format=json`)
        .set(cookie());

      expect(res.status).toBe(200);
      const rows = res.body.data ?? res.body.questions ?? res.body;
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(expected);
      // No duplicates — a batched scan with a bad offset would repeat rows.
      expect(new Set(rows.map((q) => q.id)).size).toBe(expected);
    });

    it('rejects an unauthenticated export', async () => {
      stubRejectedSession();
      const res = await request(app)
        .get(`/api/questions/export?courseId=${courseId}`)
        .set(cookie());
      expect([401, 403]).toContain(res.status);
    });
  });
});
