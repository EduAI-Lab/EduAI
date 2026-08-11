/**
 * DB-backed tests for cross-course write scoping (#1).
 *
 * The assessment/section/variant write services scope only by course OWNER. Because one
 * user can own many courses, a child resource (section / variant / question) from a
 * DIFFERENT course owned by the same user passed the owner check and could be mutated via
 * a route authorized for another course. The services must also confirm the resource
 * belongs to the authorized course (passed by the route as req.qmCourse.id).
 *
 * Both courses below are owned by the SAME user, so this isolates the cross-course hole
 * from ordinary ownership checks (which a stranger would already fail).
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb("cross-course write scoping (integration, #1)", () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let createQuestion, updateQuestion, updateQuestionOrder, createAssessment, updateAssessment, addQuestionToAssessment, removeQuestionFromAssessment;
  let createVariant, updateVariant;
  let sectionSvc;

  const USER = { id: "cuid-xc-user", email: "xc@test.com", name: "XC User" };

  beforeAll(async () => {
    const testDb = await import("../helpers/testDb.js");
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
    ({ createQuestion, updateQuestion, updateQuestionOrder, createVariant, updateVariant } = await import('../../src/services/questionService.js'));
    ({ createAssessment, addQuestionToAssessment, removeQuestionFromAssessment } = await import(
      '../../src/services/assessmentService.js'
    ));
    ({ updateAssessment } = await import('../../src/services/assessmentService.js'));
    sectionSvc = await import('../../src/services/assessmentSectionService.js');
  });

  // Two courses owned by the same user.
  let courseA, courseB, topicA, topicASecondary, topicB;
  let assessmentA, sectionA, variantA, questionA;
  let assessmentB, sectionB, variantB, questionB;

  async function makeVariant(courseId, topicId, text = "Q?") {
    const qm = await prisma.questionMetadata.create({
      data: { courseId, primaryTopicId: topicId, type: "SA", questionOrder: {} },
    });
    const variant = await prisma.variants.create({
      data: { questionMetadataId: qm.id, questionText: text, difficulty: "medium" },
    });
    return { qm, variant };
  }

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: USER.id, email: USER.email, name: USER.name } });
    await seedCoursesForNewUser(USER.id);

    const courses = await prisma.course.findMany({
      where: { userId: USER.id },
      orderBy: { id: "asc" },
    });
    courseA = courses[0];
    courseB = courses[1];
    topicA = await prisma.topics.findFirst({ where: { courseId: courseA.id } });
    topicASecondary = await prisma.topics.findFirst({ where: { courseId: courseA.id, id: { not: topicA.id } } });
    topicB = await prisma.topics.findFirst({ where: { courseId: courseB.id } });

    assessmentA = await createAssessment(USER.id, { type: 'Quiz', name: 'A Exam', courseId: courseA.id });
    sectionA = await sectionSvc.createAssessmentSection(assessmentA.id, USER.id, { name: 'A-Section' });
    ({ qm: questionA, variant: variantA } = await makeVariant(courseA.id, topicA.id, 'A?'));

    assessmentB = await createAssessment(USER.id, {
      type: "Quiz",
      name: "B Exam",
      courseId: courseB.id,
    });
    sectionB = await sectionSvc.createAssessmentSection(assessmentB.id, USER.id, {
      name: "B-Section",
    });
    const madeB = await makeVariant(courseB.id, topicB.id, "B?");
    variantB = madeB.variant;
    questionB = madeB.qm;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  describe("addVariantToSection", () => {
    it("rejects linking a variant from another course into this course section", async () => {
      await expect(
        sectionSvc.addVariantToSection(sectionA.id, USER.id, variantB.id, {}, courseA.id),
      ).rejects.toThrow(/Variant not found/);

      // ...and the cross-course variant was NOT linked to assessment A.
      const reloaded = await prisma.variants.findUnique({ where: { id: variantB.id } });
      expect(reloaded.assessmentId).not.toBe(assessmentA.id);
    });

    it("still links a variant that belongs to the authorized course", async () => {
      const link = await sectionSvc.addVariantToSection(
        sectionA.id,
        USER.id,
        variantA.id,
        {},
        courseA.id,
      );
      expect(link).toBeTruthy();
      const reloaded = await prisma.variants.findUnique({ where: { id: variantA.id } });
      expect(reloaded.assessmentId).toBe(assessmentA.id);
    });
  });

  describe('legacy SectionVariants mutation guards', () => {
    it('rejects removing a malformed foreign-course link', async () => {
      await prisma.sectionVariants.create({
        data: { sectionId: sectionA.id, variantId: variantB.id, displayOrder: 2 },
      });

      await expect(
        sectionSvc.removeVariantFromSection(sectionA.id, USER.id, variantB.id, courseA.id),
      ).rejects.toThrow(/Variant not found/);

      expect(await prisma.sectionVariants.count({ where: { sectionId: sectionA.id, variantId: variantB.id } })).toBe(1);
    });

    it('rejects reordering a malformed foreign-course link', async () => {
      await prisma.sectionVariants.create({
        data: { sectionId: sectionA.id, variantId: variantB.id, displayOrder: 2 },
      });

      await expect(
        sectionSvc.updateVariantOrderInSection(sectionA.id, USER.id, variantB.id, 9, courseA.id),
      ).rejects.toThrow(/Variant not found/);

      const link = await prisma.sectionVariants.findUnique({
        where: { sectionId_variantId: { sectionId: sectionA.id, variantId: variantB.id } },
      });
      expect(link.displayOrder).toBe(2);
    });

    it('does not remove a question link from a foreign-course section', async () => {
      await prisma.sectionVariants.create({
        data: { sectionId: sectionB.id, variantId: variantA.id, displayOrder: 3 },
      });

      const result = await sectionSvc.removeQuestionFromAllSections(questionA.id, USER.id, courseA.id);
      expect(result.removedLinks).toBe(0);
      expect(await prisma.sectionVariants.count({ where: { sectionId: sectionB.id, variantId: variantA.id } })).toBe(1);
    });
  });

  describe('section writes scoped to the authorized course', () => {
    it('rejects updating a section that lives in another course', async () => {
      await expect(
        sectionSvc.updateAssessmentSection(sectionB.id, USER.id, { name: "hijack" }, courseA.id),
      ).rejects.toThrow(/Section not found/);
    });

    it("rejects deleting a section that lives in another course", async () => {
      await expect(
        sectionSvc.deleteAssessmentSection(sectionB.id, USER.id, courseA.id),
      ).rejects.toThrow(/Section not found/);
    });

    it("still updates a section in the authorized course", async () => {
      const updated = await sectionSvc.updateAssessmentSection(
        sectionA.id,
        USER.id,
        { name: "ok" },
        courseA.id,
      );
      expect(updated.name).toBe("ok");
    });
  });

  describe("addQuestionToAssessment", () => {
    it("rejects adding a question from another course to this assessment", async () => {
      await expect(
        addQuestionToAssessment(assessmentA.id, questionB.id, 1, USER.id),
      ).rejects.toThrow(/Question not found/);
    });

    it("rejects removing a cross-course question from this assessment", async () => {
      await expect(
        removeQuestionFromAssessment(assessmentA.id, questionB.id, USER.id),
      ).rejects.toThrow(/Question not found/);
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      'rejects an invalid orderNumber (%s) in the service',
      async (orderNumber) => {
        await expect(
          addQuestionToAssessment(assessmentA.id, questionA.id, orderNumber, USER.id)
        ).rejects.toThrow(/positive safe integer/i);
      },
    );

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      'rejects an invalid orderNumber (%s) in question-order updates',
      async (orderNumber) => {
        await expect(
          updateQuestionOrder(questionA.id, assessmentA.id, orderNumber, USER.id)
        ).rejects.toThrow(/positive safe integer/i);
      },
    );
  });

  describe('resource relocation and relation integrity', () => {
    it('rejects moving a question to another course, even when the same owner has both courses', async () => {
      await expect(
        updateQuestion(questionA.id, USER.id, { courseId: courseB.id })
      ).rejects.toMatchObject({ status: 409, code: 'COURSE_RELOCATION_NOT_ALLOWED' });
    });

    it('rejects moving an assessment to another course, even when the same owner has both courses', async () => {
      await expect(
        updateAssessment(assessmentA.id, { courseId: courseB.id }, USER.id)
      ).rejects.toMatchObject({ status: 409, code: 'COURSE_RELOCATION_NOT_ALLOWED' });
    });

    it('allows a legitimate same-course question and assessment update', async () => {
      const question = await updateQuestion(questionA.id, USER.id, {
        courseId: courseA.id,
        description: 'same course question',
        primaryTopicId: topicA.id,
      });
      expect(question.courseId).toBe(courseA.id);
      expect(question.primaryTopicId).toBe(topicA.id);

      const assessment = await updateAssessment(
        assessmentA.id,
        { courseId: courseA.id, name: 'same course assessment' },
        USER.id
      );
      expect(assessment.courseId).toBe(courseA.id);
      expect(assessment.name).toBe('same course assessment');
    });

    it('rejects creating a question with a primary topic from another course', async () => {
      await expect(
        createQuestion(USER.id, {
          courseId: courseA.id,
          primaryTopicId: topicB.id,
          type: 'SA',
          description: 'foreign topic',
        })
      ).rejects.toThrow(/Primary topic not found for this course/);
    });

    it('rejects creating or updating a question with a cross-course questionOrder assessment id', async () => {
      await expect(
        createQuestion(USER.id, {
          courseId: courseA.id,
          primaryTopicId: topicA.id,
          type: 'SA',
          description: 'foreign order assessment',
          questionOrder: { [assessmentB.id]: 1 },
        })
      ).rejects.toThrow(/Assessment not found for this course/);

      await expect(
        updateQuestion(questionA.id, USER.id, { questionOrder: { [assessmentB.id]: 1 } })
      ).rejects.toThrow(/Assessment not found for this course/);
    });

    it('rejects updating a question with a primary topic from another course', async () => {
      await expect(
        updateQuestion(questionA.id, USER.id, { primaryTopicId: topicB.id })
      ).rejects.toThrow(/Primary topic not found for this course/);
    });

    it.each([
      ['assessment', ({ assessmentB: foreignAssessment }) => ({ assessmentId: foreignAssessment.id }), /Assessment not found for this course/],
      ['secondary topic', ({ topicB: foreignTopic }) => ({ secondaryTopicsId: [foreignTopic.id] }), /Secondary topic not found for this course/],
      ['reference variant', ({ variantB: foreignVariant }) => ({ referenceId: foreignVariant.id }), /Reference variant not found for this course/],
    ])('rejects creating a variant with a foreign-course %s', async (_label, payloadFactory, matcher) => {
      const payload = payloadFactory({ assessmentB, topicB, variantB });
      await expect(
        createVariant(questionA.id, { questionText: 'foreign relation', ...payload }, USER.id)
      ).rejects.toThrow(matcher);
    });

    it.each([
      ['assessment', ({ assessmentB: foreignAssessment }) => ({ assessmentId: foreignAssessment.id }), /Assessment not found for this course/],
      ['secondary topic', ({ topicB: foreignTopic }) => ({ secondaryTopicsId: [foreignTopic.id] }), /Secondary topic not found for this course/],
      ['reference variant', ({ variantB: foreignVariant }) => ({ referenceId: foreignVariant.id }), /Reference variant not found for this course/],
    ])('rejects updating a variant with a foreign-course %s', async (_label, payloadFactory, matcher) => {
      const payload = payloadFactory({ assessmentB, topicB, variantB });
      await expect(
        updateVariant(variantA.id, payload, USER.id)
      ).rejects.toThrow(matcher);
    });

    it('allows a variant with same-course assessment, topic, and reference relations', async () => {
      const created = await createVariant(questionA.id, {
        questionText: 'same course relation',
        assessmentId: assessmentA.id,
        secondaryTopicsId: [topicASecondary.id],
        referenceId: variantA.id,
      }, USER.id);
      expect(created.assessmentId).toBe(assessmentA.id);
      expect(created.secondaryTopicsId).toEqual([topicASecondary.id]);
      expect(created.referenceId).toBe(variantA.id);
    });
  });
});
