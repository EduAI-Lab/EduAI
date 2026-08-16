/**
 * DB-backed integration tests for multi-correct MCQ fields on variants
 * (selectAllThatApply + correctAnswers) via questionService.createVariant.
 *
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('MCQ multi-correct variant persistence (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser, createQuestion, createVariant;

  const USER = { id: 'cuid-mcq-multi-user', email: 'mcq-multi@test.com', name: 'MCQ Multi User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
    ({ createQuestion, createVariant } = await import('../../src/services/questionService.js'));
  });

  let courseId, topicId, questionId;

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: USER.id, email: USER.email, name: USER.name } });
    await seedCoursesForNewUser(USER.id);

    const course = await prisma.course.findFirst({ where: { userId: USER.id } });
    courseId = course.id;
    const topic = await prisma.topics.findFirst({ where: { courseId } });
    topicId = topic.id;

    const question = await createQuestion(USER.id, {
      description: 'Multi-correct MCQ fixture',
      courseId,
      primaryTopicId: topicId,
      type: 'MCQ',
    });
    questionId = question.id;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  const choices = [
    { letter: 'A', text: 'Alpha' },
    { letter: 'B', text: 'Beta' },
    { letter: 'C', text: 'Gamma' },
  ];

  it('createVariant multi-correct: answer first sorted, correctAnswers sorted, flag true', async () => {
    const variant = await createVariant(questionId, {
      questionText: 'Which apply?',
      difficulty: 'medium',
      choices,
      selectAllThatApply: true,
      correctAnswers: ['C', 'A'],
    }, USER.id);

    const row = await prisma.variants.findUnique({ where: { id: variant.id } });
    expect(row.answer).toBe('A');
    expect(row.correctAnswers).toEqual(['A', 'C']);
    expect(row.selectAllThatApply).toBe(true);
  });

  it('createVariant single-correct: flag false and correctAnswers null', async () => {
    const variant = await createVariant(questionId, {
      questionText: 'Which one?',
      difficulty: 'easy',
      answer: 'B',
      choices,
      selectAllThatApply: false,
    }, USER.id);

    const row = await prisma.variants.findUnique({ where: { id: variant.id } });
    expect(row.answer).toBe('B');
    expect(row.selectAllThatApply).toBe(false);
    expect(row.correctAnswers).toBeNull();
  });

  it('createVariant SA: selectAllThatApply false and correctAnswers null', async () => {
    const saQuestion = await createQuestion(USER.id, {
      description: 'SA fixture',
      courseId,
      primaryTopicId: topicId,
      type: 'SA',
    });

    const variant = await createVariant(saQuestion.id, {
      questionText: 'Explain briefly',
      answer: 'A short answer',
      selectAllThatApply: true,
      correctAnswers: ['A', 'C'],
    }, USER.id);

    const row = await prisma.variants.findUnique({ where: { id: variant.id } });
    expect(row.selectAllThatApply).toBe(false);
    expect(row.correctAnswers).toBeNull();
    expect(row.answer).toBe('A short answer');
  });
});
