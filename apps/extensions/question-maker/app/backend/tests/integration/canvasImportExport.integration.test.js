/**
 * DB-backed integration tests for canvasService's stateful flows, exercised in Canvas "test mode"
 * (makeCanvasRequest returns canned responses, so no real Canvas API is contacted):
 *   - saveCanvasIntegration / getCanvasIntegration
 *   - getCanvasCourses / getCanvasQuizzes / getCanvasQuizQuestions / getCanvasQuizQuestionById
 *   - importQuizFromCanvas (creates assessment + section + variant from a Canvas quiz)
 *   - exportAssessmentToCanvas (round-trips the imported assessment back out)
 *   - getCanvasCourseMapping
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('canvasService import/export (integration, test mode)', () => {
  let connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course, Topics, CanvasIntegration, Assessments, AssessmentSections, SectionVariants, Variants;
  let seedCoursesForNewUser;
  let canvas;

  const USER = { id: 'cuid-canvas-user', email: 'canvas@test.com', name: 'Canvas User' };
  const OTHER = { id: 'cuid-canvas-other', email: 'other@test.com', name: 'Other User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, sequelize } = testDb);
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, CanvasIntegration, Assessments, AssessmentSections, SectionVariants, Variants } = schema);
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
    // OTHER exists but has no Canvas integration — used for "not configured" paths.
    await User.create({ id: OTHER.id, email: OTHER.email, name: OTHER.name });
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

  describe('saveCanvasIntegration / getCanvasIntegration', () => {
    it('creates then updates the integration row for a user', async () => {
      const created = await canvas.saveCanvasIntegration(OTHER.id, {
        canvasUrl: 'https://x.test',
        apiKey: 'k1',
        isTestMode: true,
      });
      expect(created.canvasUrl).toBe('https://x.test');

      const updated = await canvas.saveCanvasIntegration(OTHER.id, {
        canvasUrl: 'https://y.test',
        apiKey: 'k2',
        isTestMode: false,
      });
      expect(updated.canvasUrl).toBe('https://y.test');
      expect(updated.isTestMode).toBe(false);

      const fetched = await canvas.getCanvasIntegration(OTHER.id);
      expect(fetched.apiKey).toBe('k2');
    });

    it('returns null when no integration exists', async () => {
      const fetched = await canvas.getCanvasIntegration('nonexistent-user');
      expect(fetched).toBeNull();
    });
  });

  describe('test-mode read endpoints', () => {
    it('lists mock courses', async () => {
      const courses = await canvas.getCanvasCourses(USER.id);
      expect(Array.isArray(courses)).toBe(true);
      expect(courses.length).toBeGreaterThan(0);
    });

    it('throws when the integration is not configured', async () => {
      await expect(canvas.getCanvasCourses(OTHER.id)).rejects.toThrow(/not configured/i);
    });

    it('lists assignment-type quizzes', async () => {
      const quizzes = await canvas.getCanvasQuizzes(USER.id, 101);
      expect(quizzes.every((q) => q.quiz_type === 'assignment' || q.quiz_type === 'graded_survey')).toBe(true);
    });

    it('lists quiz questions and fetches one by id', async () => {
      const list = await canvas.getCanvasQuizQuestions(USER.id, 101, 1);
      expect(list.length).toBeGreaterThan(0);
      const single = await canvas.getCanvasQuizQuestionById(USER.id, 101, 1, 5);
      expect(single.id).toBe(5);
      expect(Array.isArray(single.answers)).toBe(true);
    });
  });

  describe('importQuizFromCanvas', () => {
    it('imports the mock quiz into a new assessment with one variant', async () => {
      const result = await canvas.importQuizFromCanvas(USER.id, 101, 1, courseId, {
        primaryTopicId: topicId,
        assessmentName: 'Imported Exam',
      });
      expect(result.questionsImported).toBe(1);
      expect(result.assessmentName).toBe('Imported Exam');

      const variants = await Variants.findAll({ where: { assessmentId: result.assessmentId } });
      expect(variants).toHaveLength(1);
      expect(variants[0].choices).toBeTruthy();

      const mapping = await canvas.getCanvasCourseMapping(USER.id, courseId);
      expect(String(mapping.canvasCourseId)).toBe('101');
    });

    it('requires a primary topic id', async () => {
      await expect(
        canvas.importQuizFromCanvas(USER.id, 101, 1, courseId, {})
      ).rejects.toThrow(/Primary topic ID is required/);
    });

    it('throws when the local course is not found', async () => {
      await expect(
        canvas.importQuizFromCanvas(USER.id, 101, 1, 999999, { primaryTopicId: topicId })
      ).rejects.toThrow(/Local course not found/);
    });

    it('throws when the integration is not configured', async () => {
      await expect(
        canvas.importQuizFromCanvas(OTHER.id, 101, 1, courseId, { primaryTopicId: topicId })
      ).rejects.toThrow(/not configured/i);
    });
  });

  describe('exportAssessmentToCanvas', () => {
    it('exports an imported assessment back to Canvas', async () => {
      const imported = await canvas.importQuizFromCanvas(USER.id, 101, 1, courseId, {
        primaryTopicId: topicId,
      });

      const result = await canvas.exportAssessmentToCanvas(USER.id, imported.assessmentId, 101);
      expect(result.quizId).toBeDefined();
      expect(result.questionsCreated).toBeGreaterThanOrEqual(1);
      expect(result.canvasUrl).toContain('TEST MODE');
    });

    it('throws when the assessment is not found', async () => {
      await expect(
        canvas.exportAssessmentToCanvas(USER.id, 999999, 101)
      ).rejects.toThrow(/Assessment not found|Failed to export/);
    });

    it('throws when the integration is not configured', async () => {
      await expect(
        canvas.exportAssessmentToCanvas(OTHER.id, 1, 101)
      ).rejects.toThrow(/not configured/i);
    });
  });
});
