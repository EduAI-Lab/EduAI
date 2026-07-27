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
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('cross-course write scoping (integration, #1)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let createAssessment, addQuestionToAssessment, removeQuestionFromAssessment;
  let sectionSvc;

  const USER = { id: 'cuid-xc-user', email: 'xc@test.com', name: 'XC User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
    ({ createAssessment, addQuestionToAssessment, removeQuestionFromAssessment } = await import(
      '../../src/services/assessmentService.js'
    ));
    sectionSvc = await import('../../src/services/assessmentSectionService.js');
  });

  // Two courses owned by the same user.
  let courseA, courseB, topicA, topicB;
  let assessmentA, sectionA, variantA;
  let assessmentB, sectionB, variantB, questionB;

  async function makeVariant(courseId, topicId, text = 'Q?') {
    const qm = await prisma.questionMetadata.create({ data: { courseId, primaryTopicId: topicId, type: 'SA', questionOrder: {} } });
    const variant = await prisma.variants.create({ data: { questionMetadataId: qm.id, questionText: text, difficulty: 'medium' } });
    return { qm, variant };
  }

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: USER.id, email: USER.email, name: USER.name } });
    await seedCoursesForNewUser(USER.id);

    const courses = await prisma.course.findMany({ where: { userId: USER.id }, orderBy: { id: 'asc' } });
    courseA = courses[0];
    courseB = courses[1];
    topicA = await prisma.topics.findFirst({ where: { courseId: courseA.id } });
    topicB = await prisma.topics.findFirst({ where: { courseId: courseB.id } });

    assessmentA = await createAssessment(USER.id, { type: 'Quiz', name: 'A Exam', courseId: courseA.id });
    sectionA = await sectionSvc.createAssessmentSection(assessmentA.id, USER.id, { name: 'A-Section' });
    ({ variant: variantA } = await makeVariant(courseA.id, topicA.id, 'A?'));

    assessmentB = await createAssessment(USER.id, { type: 'Quiz', name: 'B Exam', courseId: courseB.id });
    sectionB = await sectionSvc.createAssessmentSection(assessmentB.id, USER.id, { name: 'B-Section' });
    const madeB = await makeVariant(courseB.id, topicB.id, 'B?');
    variantB = madeB.variant;
    questionB = madeB.qm;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  describe('addVariantToSection', () => {
    it('rejects linking a variant from another course into this course section', async () => {
      await expect(
        sectionSvc.addVariantToSection(sectionA.id, USER.id, variantB.id, {}, courseA.id)
      ).rejects.toThrow(/Variant not found/);

      // ...and the cross-course variant was NOT linked to assessment A.
      const reloaded = await prisma.variants.findUnique({ where: { id: variantB.id } });
      expect(reloaded.assessmentId).not.toBe(assessmentA.id);
    });

    it('still links a variant that belongs to the authorized course', async () => {
      const link = await sectionSvc.addVariantToSection(sectionA.id, USER.id, variantA.id, {}, courseA.id);
      expect(link).toBeTruthy();
      const reloaded = await prisma.variants.findUnique({ where: { id: variantA.id } });
      expect(reloaded.assessmentId).toBe(assessmentA.id);
    });
  });

  describe('section writes scoped to the authorized course', () => {
    it('rejects updating a section that lives in another course', async () => {
      await expect(
        sectionSvc.updateAssessmentSection(sectionB.id, USER.id, { name: 'hijack' }, courseA.id)
      ).rejects.toThrow(/Section not found/);
    });

    it('rejects deleting a section that lives in another course', async () => {
      await expect(
        sectionSvc.deleteAssessmentSection(sectionB.id, USER.id, courseA.id)
      ).rejects.toThrow(/Section not found/);
    });

    it('still updates a section in the authorized course', async () => {
      const updated = await sectionSvc.updateAssessmentSection(sectionA.id, USER.id, { name: 'ok' }, courseA.id);
      expect(updated.name).toBe('ok');
    });
  });

  describe('addQuestionToAssessment', () => {
    it('rejects adding a question from another course to this assessment', async () => {
      await expect(
        addQuestionToAssessment(assessmentA.id, questionB.id, 1, USER.id)
      ).rejects.toThrow(/Question not found/);
    });

    it('rejects removing a cross-course question from this assessment', async () => {
      await expect(
        removeQuestionFromAssessment(assessmentA.id, questionB.id, USER.id)
      ).rejects.toThrow(/Question not found/);
    });
  });
});
