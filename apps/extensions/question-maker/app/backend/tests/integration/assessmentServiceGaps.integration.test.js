/**
 * DB-backed integration tests for untested paths in assessmentService:
 *   - deleteAssessment: must detach ALL variants, not just eagerly-loaded ones
 *   - getQuestionsInAssessment: must return questions in JSONB-stored display order
 *
 * Existing tests cover createAssessment / getAssessmentsByUser / getAssessmentById.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('assessmentService — deleteAssessment and getQuestionsInAssessment (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course, Topics, Question_Metadata, Variants, Assessments;
  let seedCoursesForNewUser;
  let createAssessment, deleteAssessment, getQuestionsInAssessment, addQuestionToAssessment;

  const USER = { id: 'cuid-asm-user', email: 'asm@test.com', name: 'Asm User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, sequelize } = testDb);
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, Question_Metadata, Variants, Assessments } = schema);
    ({ seedCoursesForNewUser } = await import('../../src/services/seedNewUserService.js'));
    ({ createAssessment, deleteAssessment, getQuestionsInAssessment, addQuestionToAssessment } =
      await import('../../src/services/assessmentService.js'));
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
  });

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  async function makeAssessment(name = 'Test Exam') {
    return createAssessment(USER.id, { type: 'Quiz', name, semester: 'Fall 2026', courseId });
  }

  async function makeQuestion(order = {}) {
    return Question_Metadata.create({ courseId, primaryTopicId: topicId, type: 'SA', questionOrder: order });
  }

  async function makeVariant(questionMetadataId, assessmentId = null) {
    return Variants.create({
      questionMetadataId,
      questionText: 'Some question text',
      difficulty: 'medium',
      assessmentId,
      isDraft: true,
      isAiGenerated: false,
      secondaryTopicsId: []
    });
  }

  describe('deleteAssessment', () => {
    it('removes the assessment row from the database', async () => {
      const assessment = await makeAssessment();
      await deleteAssessment(assessment.id, USER.id);
      const found = await Assessments.findByPk(assessment.id);
      expect(found).toBeNull();
    });

    it('sets assessmentId to null on every variant linked to the deleted assessment', async () => {
      const assessment = await makeAssessment();
      const q1 = await makeQuestion();
      const q2 = await makeQuestion();
      const v1 = await makeVariant(q1.id, assessment.id);
      const v2 = await makeVariant(q2.id, assessment.id);

      await deleteAssessment(assessment.id, USER.id);

      await v1.reload();
      await v2.reload();
      expect(v1.assessmentId).toBeNull();
      expect(v2.assessmentId).toBeNull();
    });

    it('does NOT touch variants that belong to a different assessment', async () => {
      const asmA = await makeAssessment('Exam A');
      const asmB = await makeAssessment('Exam B');
      const q = await makeQuestion();
      const variant = await makeVariant(q.id, asmB.id);

      await deleteAssessment(asmA.id, USER.id);

      await variant.reload();
      expect(variant.assessmentId).toBe(asmB.id);
    });

    it('throws when the assessment does not belong to the requesting user', async () => {
      const assessment = await makeAssessment();
      await expect(deleteAssessment(assessment.id, 'cuid-wrong-user')).rejects.toThrow(
        /assessment not found/i
      );
    });

    it('throws when the assessment does not exist', async () => {
      await expect(deleteAssessment(999999, USER.id)).rejects.toThrow(/assessment not found/i);
    });
  });

  describe('getQuestionsInAssessment', () => {
    it('returns questions in the order stored in questionOrder JSONB — not insertion order', async () => {
      const assessment = await makeAssessment();

      const qA = await makeQuestion({ [assessment.id]: 3 });
      const qB = await makeQuestion({ [assessment.id]: 1 });
      const qC = await makeQuestion({ [assessment.id]: 2 });

      await makeVariant(qA.id, assessment.id);
      await makeVariant(qB.id, assessment.id);
      await makeVariant(qC.id, assessment.id);

      const result = await getQuestionsInAssessment(assessment.id, USER.id);

      const ids = result.map(q => q.id);
      expect(ids).toEqual([qB.id, qC.id, qA.id]);
    });

    it('excludes questions that are not in this assessment\'s questionOrder', async () => {
      const asmA = await makeAssessment('A');
      const asmB = await makeAssessment('B');

      const qInA = await makeQuestion({ [asmA.id]: 1 });
      const qInB = await makeQuestion({ [asmB.id]: 1 });

      await makeVariant(qInA.id, asmA.id);
      await makeVariant(qInB.id, asmB.id);

      const result = await getQuestionsInAssessment(asmA.id, USER.id);
      const ids = result.map(q => q.id);

      expect(ids).toContain(qInA.id);
      expect(ids).not.toContain(qInB.id);
    });

    it('returns an empty array when the assessment has no questions', async () => {
      const assessment = await makeAssessment();
      const result = await getQuestionsInAssessment(assessment.id, USER.id);
      expect(result).toEqual([]);
    });

    it('throws when the assessment does not belong to the requesting user', async () => {
      const assessment = await makeAssessment();
      await expect(
        getQuestionsInAssessment(assessment.id, 'cuid-wrong-user')
      ).rejects.toThrow(/assessment not found/i);
    });
  });
});
