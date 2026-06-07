/**
 * DB-backed integration tests for questionService.saveExtractedQuestions().
 *
 * What this function is supposed to do:
 * - Accept a course-scoped batch of raw extracted questions and persist them
 *   atomically: metadata row + variant + (optionally) an assessment/section/sectionVariant.
 * - All new variants must start as drafts (isDraft=true).
 * - Topic resolution: use provided primaryTopicId when valid, fall back to topicName
 *   (creating the topic if absent), fall back to an auto-created "Uploaded Questions" topic.
 * - Questions with empty questionText are silently skipped.
 * - Questions without a summary throw — the entire transaction rolls back.
 * - If all questions are skipped (all empty text) the transaction rolls back with an error.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('saveExtractedQuestions (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course, Topics, Question_Metadata, Variants, Assessments, AssessmentSections, SectionVariants;
  let seedCoursesForNewUser, saveExtractedQuestions;

  const USER = { id: 'cuid-save-user', email: 'save@test.com', name: 'Save User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, sequelize } = testDb);
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course, Topics, Question_Metadata, Variants, Assessments, AssessmentSections, SectionVariants } = schema);
    ({ seedCoursesForNewUser } = await import('../../src/services/seedNewUserService.js'));
    ({ saveExtractedQuestions } = await import('../../src/services/questionService.js'));
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

  function validQuestion(overrides = {}) {
    return {
      question: 'What is photosynthesis?',
      summary: 'Definition of photosynthesis',
      type: 'SA',
      difficulty: 'medium',
      answer: 'A process plants use to convert light into energy',
      primaryTopicId: topicId,
      ...overrides
    };
  }

  it('persists one metadata row and one variant per valid question', async () => {
    const before = await Question_Metadata.count({ where: { courseId } });

    await saveExtractedQuestions(USER.id, {
      courseId,
      questions: [validQuestion(), validQuestion({ question: 'What is mitosis?' })]
    });

    const after = await Question_Metadata.count({ where: { courseId } });
    expect(after - before).toBe(2);
  });

  it('all created variants start as drafts — never approved automatically', async () => {
    const { questions } = await saveExtractedQuestions(USER.id, {
      courseId,
      questions: [validQuestion()]
    });

    const metaIds = questions.map(q => q.id);
    const variants = await Variants.findAll({
      where: { questionMetadataId: metaIds }
    });
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every(v => v.isDraft === true)).toBe(true);
  });

  it('silently skips questions with empty questionText without erroring', async () => {
    const before = await Question_Metadata.count({ where: { courseId } });

    await saveExtractedQuestions(USER.id, {
      courseId,
      questions: [
        { question: '', summary: 'empty', type: 'SA', difficulty: 'easy', primaryTopicId: topicId },
        validQuestion()
      ]
    });

    const after = await Question_Metadata.count({ where: { courseId } });
    expect(after - before).toBe(1);
  });

  it('throws and rolls back the entire transaction when any question is missing a summary', async () => {
    const before = await Question_Metadata.count({ where: { courseId } });

    await expect(
      saveExtractedQuestions(USER.id, {
        courseId,
        questions: [
          validQuestion(),
          { question: 'What is mitosis?', type: 'SA', difficulty: 'easy', primaryTopicId: topicId }
        ]
      })
    ).rejects.toThrow(/summary/i);

    const after = await Question_Metadata.count({ where: { courseId } });
    expect(after).toBe(before);
  });

  it('throws and rolls back when all questions have empty text — nothing is saved', async () => {
    const before = await Question_Metadata.count({ where: { courseId } });

    await expect(
      saveExtractedQuestions(USER.id, {
        courseId,
        questions: [{ question: '   ', summary: 'all blank', type: 'SA', difficulty: 'easy' }]
      })
    ).rejects.toThrow();

    expect(await Question_Metadata.count({ where: { courseId } })).toBe(before);
  });

  it('throws when the course does not belong to the requesting user', async () => {
    await expect(
      saveExtractedQuestions('cuid-wrong-user', {
        courseId,
        questions: [validQuestion()]
      })
    ).rejects.toThrow(/course not found/i);
  });

  it('throws when questions array is empty', async () => {
    await expect(
      saveExtractedQuestions(USER.id, { courseId, questions: [] })
    ).rejects.toThrow(/questions/i);
  });

  describe('topic fallback resolution', () => {
    it('uses the provided primaryTopicId when it exists in the course', async () => {
      const { questions } = await saveExtractedQuestions(USER.id, {
        courseId,
        questions: [validQuestion({ primaryTopicId: topicId })]
      });
      const meta = await Question_Metadata.findByPk(questions[0].id);
      expect(meta.primaryTopicId).toBe(topicId);
    });

    it('falls back to topicName: creates the topic and assigns it when primaryTopicId is absent', async () => {
      const topicsBefore = await Topics.count({ where: { courseId } });

      const { questions } = await saveExtractedQuestions(USER.id, {
        courseId,
        topicName: 'Brand New Topic',
        questions: [validQuestion({ primaryTopicId: undefined })]
      });

      const topicsAfter = await Topics.count({ where: { courseId } });
      expect(topicsAfter).toBe(topicsBefore + 1);

      const newTopic = await Topics.findOne({ where: { name: 'Brand New Topic', courseId } });
      expect(newTopic).toBeTruthy();

      const meta = await Question_Metadata.findByPk(questions[0].id);
      expect(meta.primaryTopicId).toBe(newTopic.id);
    });

    it('reuses an existing topic of the same name rather than creating a duplicate', async () => {
      const existingTopic = await Topics.create({ name: 'Existing Topic', courseId });
      const topicsBefore = await Topics.count({ where: { courseId } });

      await saveExtractedQuestions(USER.id, {
        courseId,
        topicName: 'Existing Topic',
        questions: [validQuestion({ primaryTopicId: undefined })]
      });

      expect(await Topics.count({ where: { courseId } })).toBe(topicsBefore);
      const meta = await Question_Metadata.findOne({ order: [['createdAt', 'DESC']] });
      expect(meta.primaryTopicId).toBe(existingTopic.id);
    });

    it('auto-creates an "Uploaded Questions" topic when no primaryTopicId and no topicName given — but only if no topics exist', async () => {
      const newCourse = await Course.create({ userId: USER.id, name: 'Empty Course', code: 'EMPTY-1' });
      const topicsBefore = await Topics.count({ where: { courseId: newCourse.id } });
      expect(topicsBefore).toBe(0);

      await saveExtractedQuestions(USER.id, {
        courseId: newCourse.id,
        questions: [validQuestion({ primaryTopicId: undefined })]
      });

      const createdTopic = await Topics.findOne({ where: { courseId: newCourse.id } });
      expect(createdTopic.name).toBe('Uploaded Questions');
    });
  });

  describe('MCQ questions', () => {
    it('normalizes MCQ answer to the single leading letter', async () => {
      const { questions } = await saveExtractedQuestions(USER.id, {
        courseId,
        questions: [validQuestion({
          type: 'MCQ',
          question: 'What color is the sky?',
          answer: 'B) Blue',
          choices: [
            { letter: 'A', text: 'Red' },
            { letter: 'B', text: 'Blue' }
          ]
        })]
      });

      const variant = await Variants.findOne({
        include: [{ association: 'questionMetadata', where: { id: questions[0].id } }]
      });
      expect(variant.answer).toBe('B');
    });

    it('stores validated choices on MCQ variants', async () => {
      const choices = [{ letter: 'A', text: 'Option A' }, { letter: 'B', text: 'Option B' }];
      const { questions } = await saveExtractedQuestions(USER.id, {
        courseId,
        questions: [validQuestion({ type: 'MCQ', question: 'Pick one', choices })]
      });

      const variant = await Variants.findOne({
        include: [{ association: 'questionMetadata', where: { id: questions[0].id } }]
      });
      expect(Array.isArray(variant.choices)).toBe(true);
      expect(variant.choices).toHaveLength(2);
    });

    it('stores null choices when MCQ choices are invalid (fewer than 2)', async () => {
      const { questions } = await saveExtractedQuestions(USER.id, {
        courseId,
        questions: [validQuestion({
          type: 'MCQ',
          question: 'Pick one',
          choices: [{ letter: 'A', text: 'Only option' }]
        })]
      });

      const variant = await Variants.findOne({
        include: [{ association: 'questionMetadata', where: { id: questions[0].id } }]
      });
      expect(variant.choices).toBeNull();
    });
  });

  describe('with assessment payload', () => {
    const assessment = { type: 'Quiz', name: 'Extraction Exam', semester: 'Fall 2026' };

    it('creates one assessment and one section when assessment payload is provided', async () => {
      const assessmentsBefore = await Assessments.count({ where: { courseId } });
      const sectionsBefore = await AssessmentSections.count();

      await saveExtractedQuestions(USER.id, { courseId, questions: [validQuestion()], assessment });

      expect(await Assessments.count({ where: { courseId } })).toBe(assessmentsBefore + 1);
      expect(await AssessmentSections.count()).toBe(sectionsBefore + 1);
    });

    it('links each created variant to the assessment section via SectionVariants', async () => {
      const { assessmentId } = await saveExtractedQuestions(USER.id, {
        courseId,
        questions: [validQuestion(), validQuestion({ question: 'Second question?' })],
        assessment
      });

      const section = await AssessmentSections.findOne({ where: { assessmentId } });
      const links = await SectionVariants.findAll({ where: { sectionId: section.id } });
      expect(links).toHaveLength(2);
    });

    it('stores questions in submission order within the assessment (displayOrder 0-based)', async () => {
      const { assessmentId } = await saveExtractedQuestions(USER.id, {
        courseId,
        questions: [
          validQuestion({ question: 'First' }),
          validQuestion({ question: 'Second' }),
          validQuestion({ question: 'Third' })
        ],
        assessment
      });

      const section = await AssessmentSections.findOne({ where: { assessmentId } });
      const links = await SectionVariants.findAll({
        where: { sectionId: section.id },
        order: [['displayOrder', 'ASC']]
      });
      expect(links.map(l => l.displayOrder)).toEqual([0, 1, 2]);
    });

    it('throws when assessment is missing required fields (type, name, semester)', async () => {
      await expect(
        saveExtractedQuestions(USER.id, {
          courseId,
          questions: [validQuestion()],
          assessment: { name: 'Incomplete' }
        })
      ).rejects.toThrow();
    });
  });
});
