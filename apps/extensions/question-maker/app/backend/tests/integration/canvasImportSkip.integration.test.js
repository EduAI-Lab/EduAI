/**
 * DB-backed test for importQuizFromCanvas's per-question skip path (#3).
 *
 * When a question fails to convert (unsupported type) or persist, the loop is meant to
 * record it in `skippedQuestions` and continue. The catch block referenced `canvasQuestion`,
 * which was `let`-declared inside the `try` and therefore out of scope in the `catch` —
 * so any skip threw `ReferenceError: canvasQuestion is not defined`, which escaped the loop
 * and aborted the ENTIRE import with a generic error instead of skipping one question.
 *
 * We force the failure by making Question_Metadata.create reject, which drives the same
 * catch. Before the fix the import rejects with the ReferenceError message; after the fix
 * the question is skipped and the loop ends with its intentional "No questions could be
 * imported" guard (proving the catch ran without throwing on `canvasQuestion`).
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('importQuizFromCanvas per-question skip (integration, #3)', () => {
  let connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course, Topics, CanvasIntegration, Question_Metadata;
  let seedCoursesForNewUser;
  let canvas;

  const USER = { id: 'cuid-canvas-skip-user', email: 'canvas-skip@test.com', name: 'Canvas Skip User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, sequelize } = testDb);
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, CanvasIntegration, Question_Metadata } = schema);
    ({ seedCoursesForNewUser } = await import('../../src/services/seedNewUserService.js'));
    canvas = await import('../../src/services/canvasService.js');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  let courseId, topicId;

  beforeEach(async () => {
    await truncateTestDatabase();
    await User.create({ id: USER.id, email: USER.email, name: USER.name });
    await seedCoursesForNewUser(USER.id);
    const course = await Course.findOne({ where: { userId: USER.id } });
    courseId = course.id;
    const topic = await Topics.findOne({ where: { courseId } });
    topicId = topic.id;

    await CanvasIntegration.create({
      userId: USER.id,
      canvasUrl: 'https://canvas.test',
      apiKey: 'test-token',
      isTestMode: true,
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (sequelize) await sequelize.close();
  });

  it('skips a failing question without a ReferenceError in the catch', async () => {
    const spy = vi.spyOn(Question_Metadata, 'create').mockRejectedValue(new Error('simulated insert failure'));
    try {
      const promise = canvas.importQuizFromCanvas(USER.id, 101, 1, courseId, { primaryTopicId: topicId });
      // After the fix the catch runs cleanly, the question is skipped, and the loop hits its
      // intentional empty-import guard. Before the fix it rejects with "canvasQuestion is not defined".
      await expect(promise).rejects.toThrow(/No questions could be imported/);
      await expect(promise).rejects.not.toThrow(/canvasQuestion is not defined/);
    } finally {
      spy.mockRestore();
    }
  });
});
