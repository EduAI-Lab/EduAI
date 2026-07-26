/**
 * DB-backed coverage for the #1040 review follow-up: offset pagination over
 * `createdAt DESC` alone isn't stable when rows share a timestamp — the `id DESC`
 * tie-breaker added to getQuestionsByUser/getAssessmentsByUser must keep every
 * row visible exactly once across consecutive page requests.
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('getQuestionsByUser / getAssessmentsByUser — tied createdAt pagination (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course, Topics, Question_Metadata, Assessments;
  let getQuestionsByUser, getAssessmentsByUser;

  const USER = { id: 'cuid-tie-user', email: 'tie@test.com', name: 'Tie User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, sequelize } = testDb);
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, Question_Metadata, Assessments } = schema);
    ({ getQuestionsByUser } = await import('../../src/services/questionService.js'));
    ({ getAssessmentsByUser } = await import('../../src/services/assessmentService.js'));
  });

  let courseId, topicId;

  beforeEach(async () => {
    await truncateTestDatabase();
    await User.create({ id: USER.id, email: USER.email, name: USER.name });

    // Built directly (not via the seedCoursesForNewUser fixture) so the course
    // starts with zero pre-existing questions/assessments — the fixture seeds
    // sample content per course that would confound the exact row counts below.
    const course = await Course.create({ userId: USER.id, coreCourseId: `core-tie-${USER.id}` });
    courseId = course.id;
    const topic = await Topics.create({ name: 'Tie Topic', courseId });
    topicId = topic.id;
  });

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  it('does not duplicate or skip rows across pages when every row shares the same createdAt', async () => {
    const tiedTimestamp = new Date('2026-01-01T00:00:00.000Z');
    const rows = [];
    for (let i = 0; i < 5; i += 1) {
      rows.push(
        await Question_Metadata.create({
          courseId,
          primaryTopicId: topicId,
          type: 'SA',
          createdAt: tiedTimestamp,
          updatedAt: tiedTimestamp,
        }),
      );
    }
    const allIds = rows.map((r) => r.id).sort((a, b) => a - b);

    const page1 = await getQuestionsByUser(USER.id, { courseId, limit: 3, offset: 0 });
    const page2 = await getQuestionsByUser(USER.id, { courseId, limit: 3, offset: 3 });

    expect(page1.items).toHaveLength(3);
    expect(page2.items).toHaveLength(2);

    const seenIds = [...page1.items, ...page2.items].map((q) => q.id).sort((a, b) => a - b);
    expect(seenIds).toEqual(allIds);
    expect(new Set(seenIds).size).toBe(allIds.length);
  });

  it('search matches variant questionText even when description is null/short', async () => {
    const { Variants } = await import('../../src/schema/index.js');
    const visible = await Question_Metadata.create({
      courseId,
      primaryTopicId: topicId,
      type: 'SA',
      description: null,
    });
    await Variants.create({
      questionMetadataId: visible.id,
      questionText: 'Explain how a binary search tree rotates on insert',
      difficulty: 'hard',
      reasoningLevel: 'analytical',
      isAiGenerated: false,
      isDraft: true,
    });
    const hidden = await Question_Metadata.create({
      courseId,
      primaryTopicId: topicId,
      type: 'SA',
      description: 'unrelated summary',
    });
    await Variants.create({
      questionMetadataId: hidden.id,
      questionText: 'What is a linked list?',
      difficulty: 'easy',
      reasoningLevel: 'factual',
      isAiGenerated: false,
      isDraft: true,
    });

    const page = await getQuestionsByUser(USER.id, {
      courseId,
      search: 'binary search tree',
      limit: 50,
      offset: 0,
    });
    expect(page.total).toBe(1);
    expect(page.items.map((q) => q.id)).toEqual([visible.id]);
  });

  it('filters by type/difficulty in SQL before paging', async () => {
    const { Variants } = await import('../../src/schema/index.js');
    const hardMcq = await Question_Metadata.create({
      courseId,
      primaryTopicId: topicId,
      type: 'MCQ',
      description: 'hard mcq',
    });
    await Variants.create({
      questionMetadataId: hardMcq.id,
      questionText: 'Hard MCQ stem',
      difficulty: 'hard',
      reasoningLevel: 'factual',
      isAiGenerated: true,
      isDraft: false,
    });
    const easySa = await Question_Metadata.create({
      courseId,
      primaryTopicId: topicId,
      type: 'SA',
      description: 'easy sa',
    });
    await Variants.create({
      questionMetadataId: easySa.id,
      questionText: 'Easy SA stem',
      difficulty: 'easy',
      reasoningLevel: 'factual',
      isAiGenerated: false,
      isDraft: true,
    });

    const page = await getQuestionsByUser(USER.id, {
      courseId,
      types: ['MCQ'],
      difficulties: ['hard'],
      aiGenerated: 'ai',
      draftStatus: 'reviewed',
      limit: 50,
      offset: 0,
    });
    expect(page.total).toBe(1);
    expect(page.items.map((q) => q.id)).toEqual([hardMcq.id]);
  });

  it('assessments: does not duplicate or skip rows across pages when every row shares the same createdAt', async () => {
    const tiedTimestamp = new Date('2026-01-01T00:00:00.000Z');
    const rows = [];
    for (let i = 0; i < 5; i += 1) {
      rows.push(
        await Assessments.create({
          courseId,
          type: 'Quiz',
          name: `Tied Quiz ${i}`,
          createdAt: tiedTimestamp,
          updatedAt: tiedTimestamp,
        }),
      );
    }
    const allIds = rows.map((r) => r.id).sort((a, b) => a - b);

    const page1 = await getAssessmentsByUser(USER.id, { courseId, limit: 3, offset: 0 });
    const page2 = await getAssessmentsByUser(USER.id, { courseId, limit: 3, offset: 3 });

    expect(page1.items).toHaveLength(3);
    expect(page2.items).toHaveLength(2);

    const seenIds = [...page1.items, ...page2.items].map((a) => a.id).sort((a, b) => a - b);
    expect(seenIds).toEqual(allIds);
    expect(new Set(seenIds).size).toBe(allIds.length);
  });
});
