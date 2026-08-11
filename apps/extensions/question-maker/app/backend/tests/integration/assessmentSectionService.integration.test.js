/**
 * DB-backed integration tests for assessmentSectionService — section CRUD, variant linking,
 * and the question-usage helpers. Ownership is enforced via the Course->user join on every path.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('assessmentSectionService (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let createAssessment;
  let svc;

  const USER = { id: 'cuid-sect-user', email: 'sect@test.com', name: 'Sect User' };
  const STRANGER = { id: 'cuid-sect-stranger', email: 'stranger@test.com', name: 'Stranger' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
    ({ createAssessment } = await import('../../src/services/assessmentService.js'));
    svc = await import('../../src/services/assessmentSectionService.js');
  });

  let courseId, topicId, assessmentId;

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: USER.id, email: USER.email, name: USER.name } });
    await prisma.user.create({ data: { id: STRANGER.id, email: STRANGER.email, name: STRANGER.name } });
    await seedCoursesForNewUser(USER.id);

    const course = await prisma.course.findFirst({ where: { userId: USER.id } });
    courseId = course.id;
    const topic = await prisma.topics.findFirst({ where: { courseId } });
    topicId = topic.id;

    const assessment = await createAssessment(USER.id, {
      type: 'Quiz', name: 'Sect Exam', courseId,
    });
    assessmentId = assessment.id;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function makeVariant(text = 'Q?') {
    const qm = await prisma.questionMetadata.create({ data: { courseId, primaryTopicId: topicId, type: 'SA', questionOrder: {} } });
    return prisma.variants.create({ data: { questionMetadataId: qm.id, questionText: text, difficulty: 'medium' } });
  }

  describe('createAssessmentSection', () => {
    it('creates a section defaulting to the next position', async () => {
      const a = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'A' });
      const b = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'B' });
      expect(a.position).toBe(0);
      expect(b.position).toBe(1);
      expect(a.name).toBe('A');
    });

    it('honors an explicit position and trims/defaults fields', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: '   ', position: 5 });
      expect(s.position).toBe(5);
      expect(s.name).toBe('Section');
      expect(s.description).toBeNull();
    });

    it('throws when the assessment does not belong to the user', async () => {
      await expect(svc.createAssessmentSection(assessmentId, STRANGER.id, { name: 'X' }))
        .rejects.toThrow(/Assessment not found/);
    });
  });

  describe('getSectionsForAssessment', () => {
    it('returns sections ordered by position with nested variants', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'Only' });
      const v = await makeVariant('Nested?');
      await svc.addVariantToSection(s.id, USER.id, v.id);

      const sections = await svc.getSectionsForAssessment(assessmentId, USER.id);
      expect(sections).toHaveLength(1);
      expect(sections[0].sectionVariants).toHaveLength(1);
      expect(sections[0].sectionVariants[0].variant.questionText).toBe('Nested?');
    });
  });

  describe('updateAssessmentSection', () => {
    it('updates provided fields and verifies ownership', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'Old' });
      const updated = await svc.updateAssessmentSection(s.id, USER.id, { name: 'New', position: 3, description: 'desc' });
      expect(updated.name).toBe('New');
      expect(updated.position).toBe(3);
      expect(updated.description).toBe('desc');
    });

    it('throws when the section does not exist', async () => {
      await expect(svc.updateAssessmentSection(999999, USER.id, { name: 'Y' }))
        .rejects.toThrow(/Section not found/);
    });
  });

  describe('variant linking', () => {
    it('adds a variant (linking it to the assessment) and updates its display order', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'S' });
      const v = await makeVariant();
      const link = await svc.addVariantToSection(s.id, USER.id, v.id);
      expect(link.displayOrder).toBe(0);

      const reloadedV = await prisma.variants.findUnique({ where: { id: v.id } });
      expect(reloadedV.assessmentId).toBe(assessmentId);

      const reordered = await svc.updateVariantOrderInSection(s.id, USER.id, v.id, 7);
      expect(reordered.displayOrder).toBe(7);
    });

    it('throws when linking a variant the user does not own', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'S' });
      await expect(svc.addVariantToSection(s.id, USER.id, 999999)).rejects.toThrow(/Variant not found/);
    });

    it('removes a variant and clears the assessment link when it was the last reference', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'S' });
      const v = await makeVariant();
      await svc.addVariantToSection(s.id, USER.id, v.id);

      const ok = await svc.removeVariantFromSection(s.id, USER.id, v.id);
      expect(ok).toBe(true);
      const reloadedV = await prisma.variants.findUnique({ where: { id: v.id } });
      expect(reloadedV.assessmentId).toBeNull();
    });

    it('throws when removing a variant absent from the section', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'S' });
      const v = await makeVariant();
      await expect(svc.removeVariantFromSection(s.id, USER.id, v.id)).rejects.toThrow(/not found in section/);
    });

    it('throws when reordering a variant absent from the section', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'S' });
      const v = await makeVariant();
      await expect(svc.updateVariantOrderInSection(s.id, USER.id, v.id, 1)).rejects.toThrow(/not found in section/);
    });
  });

  describe('deleteAssessmentSection', () => {
    it('deletes the section and clears the variant assessment link', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'S' });
      const v = await makeVariant();
      await svc.addVariantToSection(s.id, USER.id, v.id);

      const ok = await svc.deleteAssessmentSection(s.id, USER.id);
      expect(ok).toBe(true);
      expect(await prisma.assessmentSections.findUnique({ where: { id: s.id } })).toBeNull();
      const reloadedV = await prisma.variants.findUnique({ where: { id: v.id } });
      expect(reloadedV.assessmentId).toBeNull();
    });
  });

  describe('checkQuestionInAssessments / removeQuestionFromAllSections', () => {
    it('reports a question that is not in any assessment', async () => {
      const qm = await prisma.questionMetadata.create({ data: { courseId, primaryTopicId: topicId, type: "SA", questionOrder: {} } });
      const res = await svc.checkQuestionInAssessments(qm.id, USER.id);
      expect(res).toEqual({ isInAssessments: false, assessmentIds: [] });
    });

    it('reports the assessments a linked question belongs to, then removes all links', async () => {
      const s = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'S' });
      const qm = await prisma.questionMetadata.create({ data: { courseId, primaryTopicId: topicId, type: "SA", questionOrder: {} } });
      const v = await prisma.variants.create({ data: { questionMetadataId: qm.id, questionText: "Linked?", difficulty: "easy" } });
      await svc.addVariantToSection(s.id, USER.id, v.id);

      const check = await svc.checkQuestionInAssessments(qm.id, USER.id);
      expect(check.isInAssessments).toBe(true);
      expect(check.assessmentIds).toContain(assessmentId);

      const removed = await svc.removeQuestionFromAllSections(qm.id, USER.id);
      expect(removed.removedLinks).toBe(1);
      expect(removed.affectedAssessments).toContain(assessmentId);

      const after = await prisma.sectionVariants.count({ where: { variantId: v.id } });
      expect(after).toBe(0);
    });

    it('returns empty results when a question has no variants', async () => {
      const qm = await prisma.questionMetadata.create({ data: { courseId, primaryTopicId: topicId, type: "SA", questionOrder: {} } });
      const removed = await svc.removeQuestionFromAllSections(qm.id, USER.id);
      expect(removed).toEqual({ removedLinks: 0, affectedAssessments: [] });
    });

    it('throws when the question is not owned by the user', async () => {
      const qm = await prisma.questionMetadata.create({ data: { courseId, primaryTopicId: topicId, type: "SA", questionOrder: {} } });
      await expect(svc.checkQuestionInAssessments(qm.id, STRANGER.id)).rejects.toThrow(/Question not found/);
      await expect(svc.removeQuestionFromAllSections(qm.id, STRANGER.id)).rejects.toThrow(/Question not found/);
    });
  });

  describe('reorderAssessmentSections', () => {
    it('rewrites positions to 1..n in the given order', async () => {
      const a = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'A' });
      const b = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'B' });
      const c = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'C' });

      const reordered = await svc.reorderAssessmentSections(
        assessmentId,
        USER.id,
        [c.id, a.id, b.id],
      );

      expect(reordered.map((s) => ({ id: s.id, position: s.position }))).toEqual([
        { id: c.id, position: 1 },
        { id: a.id, position: 2 },
        { id: b.id, position: 3 },
      ]);
    });

    it('rejects incomplete, duplicate, or foreign section ids', async () => {
      const a = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'A' });
      const b = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'B' });

      await expect(svc.reorderAssessmentSections(assessmentId, USER.id, [a.id]))
        .rejects.toThrow(/sectionIds/i);
      await expect(svc.reorderAssessmentSections(assessmentId, USER.id, [a.id, a.id]))
        .rejects.toThrow(/sectionIds/i);
      await expect(svc.reorderAssessmentSections(assessmentId, USER.id, [a.id, b.id, 999999]))
        .rejects.toThrow(/sectionIds/i);
    });

    it('throws when the assessment does not belong to the user', async () => {
      const a = await svc.createAssessmentSection(assessmentId, USER.id, { name: 'A' });
      await expect(svc.reorderAssessmentSections(assessmentId, STRANGER.id, [a.id]))
        .rejects.toThrow(/Assessment not found/);
    });
  });
});
