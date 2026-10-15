/**
 * DB-backed tests for assessment topic limits (#1974): validating and storing
 * the chosen topics, and refusing to narrow an assessment that already holds
 * off-topic questions.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb("assessment topic scope (integration)", () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let createAssessment, updateAssessment;
  let sections, questions;

  const USER = { id: "cuid-topic-user", email: "topic@test.com", name: "Topic User" };

  beforeAll(async () => {
    const testDb = await import("../helpers/testDb.js");
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();
    ({ createAssessment, updateAssessment } =
      await import("../../src/services/assessmentService.js"));
    sections = await import("../../src/services/assessmentSectionService.js");
    questions = await import("../../src/services/questionService.js");
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  let courseId, otherCourseId, topicA, topicB, topicC, foreignTopic;

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: USER });
    const course = await prisma.course.create({ data: { userId: USER.id } });
    const other = await prisma.course.create({ data: { userId: USER.id } });
    courseId = course.id;
    otherCourseId = other.id;
    const mk = (id, name, cId) => prisma.topics.create({ data: { id, name, courseId: cId } });
    topicA = (await mk("topic-a", "Alpha", courseId)).id;
    topicB = (await mk("topic-b", "Beta", courseId)).id;
    topicC = (await mk("topic-c", "Gamma", courseId)).id;
    foreignTopic = (await mk("topic-x", "Foreign", otherCourseId)).id;
  });

  async function makeVariant(primaryTopicId, text = "Q?") {
    const qm = await prisma.questionMetadata.create({
      data: { courseId, primaryTopicId, type: "SA", questionOrder: {}, description: text },
    });
    const variant = await prisma.variants.create({
      data: { questionMetadataId: qm.id, questionText: text, difficulty: "medium" },
    });
    return { question: qm, variant };
  }

  const create = (primaryTopicIds, extra = {}) =>
    createAssessment(USER.id, {
      type: "Quiz",
      name: "Topic Quiz",
      courseId,
      blueprintConfig: { primaryTopicIds, ...extra },
    });

  describe("createAssessment", () => {
    it("stores the normalized topic selection", async () => {
      const a = await create([` ${topicA}`, topicB, topicA]);
      const row = await prisma.assessments.findUnique({ where: { id: a.id } });
      expect(row.blueprintConfig.primaryTopicIds).toEqual([topicA, topicB]);
    });

    it("rejects a topic from another course", async () => {
      await expect(create([topicA, foreignTopic])).rejects.toMatchObject({
        status: 400,
        code: "QM_ASSESSMENT_TOPICS_INVALID",
      });
    });

    it("rejects a non-array selection", async () => {
      await expect(create("topic-a")).rejects.toMatchObject({
        code: "QM_ASSESSMENT_TOPICS_INVALID",
      });
    });

    it("rejects a blueprintConfig that is not a plain object", async () => {
      for (const bad of ["abc", ["x"], 5]) {
        await expect(
          createAssessment(USER.id, { type: "Quiz", name: "Bad", courseId, blueprintConfig: bad }),
        ).rejects.toMatchObject({ status: 400, code: "QM_ASSESSMENT_BLUEPRINT_INVALID" });
      }
    });

    it("still creates an unrestricted assessment without blueprintConfig", async () => {
      const a = await createAssessment(USER.id, { type: "Quiz", name: "Plain", courseId });
      expect(a.blueprintConfig).toBeNull();
    });
  });

  describe("updateAssessment", () => {
    it("merges blueprintConfig so keys the client omits survive", async () => {
      const a = await create([], { studyRole: "reference_baseline" });
      await updateAssessment(a.id, { blueprintConfig: { primaryTopicIds: [topicA] } }, USER.id);
      const row = await prisma.assessments.findUnique({ where: { id: a.id } });
      expect(row.blueprintConfig).toMatchObject({
        studyRole: "reference_baseline",
        primaryTopicIds: [topicA],
      });
    });

    it("leaves the stored config untouched on a rename-only update", async () => {
      const a = await create([topicA]);
      const { variant } = await makeVariant(topicA);
      const section = await sections.createAssessmentSection(a.id, USER.id, { name: "S" });
      await sections.addVariantToSection(section.id, USER.id, variant.id);
      await updateAssessment(a.id, { name: "Renamed" }, USER.id);
      const row = await prisma.assessments.findUnique({ where: { id: a.id } });
      expect(row.name).toBe("Renamed");
      expect(row.blueprintConfig.primaryTopicIds).toEqual([topicA]);
    });

    it("rejects a non-object blueprintConfig and treats a stored one as empty", async () => {
      const a = await create([]);
      await expect(
        updateAssessment(a.id, { blueprintConfig: "abc" }, USER.id),
      ).rejects.toMatchObject({ status: 400, code: "QM_ASSESSMENT_BLUEPRINT_INVALID" });
      await prisma.assessments.update({ where: { id: a.id }, data: { blueprintConfig: "xyz" } });
      await updateAssessment(a.id, { blueprintConfig: { primaryTopicIds: [topicA] } }, USER.id);
      const row = await prisma.assessments.findUnique({ where: { id: a.id } });
      expect(row.blueprintConfig).toEqual({ primaryTopicIds: [topicA] });
    });

    it("rejects a foreign topic id", async () => {
      const a = await create([]);
      await expect(
        updateAssessment(a.id, { blueprintConfig: { primaryTopicIds: [foreignTopic] } }, USER.id),
      ).rejects.toMatchObject({ status: 400, code: "QM_ASSESSMENT_TOPICS_INVALID" });
    });

    it("refuses to narrow when a section holds an off-topic question, naming it once", async () => {
      const a = await create([]);
      const onTopic = await makeVariant(topicA, "On topic");
      const offTopic = await makeVariant(topicC, "Off topic");
      const sibling = await prisma.variants.create({
        data: {
          questionMetadataId: offTopic.question.id,
          questionText: "Off topic v2",
          difficulty: "easy",
        },
      });
      const section = await sections.createAssessmentSection(a.id, USER.id, { name: "S" });
      for (const v of [onTopic.variant, offTopic.variant, sibling]) {
        await sections.addVariantToSection(section.id, USER.id, v.id);
      }

      const err = await updateAssessment(
        a.id,
        { blueprintConfig: { primaryTopicIds: [topicA, topicB] } },
        USER.id,
      ).catch((e) => e);
      expect(err).toMatchObject({ status: 409, code: "QM_ASSESSMENT_TOPIC_CONFLICT" });
      expect(err.details.questions).toEqual([
        { id: offTopic.question.id, description: "Off topic" },
      ]);

      const row = await prisma.assessments.findUnique({ where: { id: a.id } });
      expect(row.blueprintConfig.primaryTopicIds).toEqual([]);
    });

    it("counts a variant linked only through variants.assessment_id", async () => {
      const a = await create([]);
      const offTopic = await makeVariant(topicC, "Direct link");
      await prisma.variants.update({
        where: { id: offTopic.variant.id },
        data: { assessmentId: a.id },
      });
      await expect(
        updateAssessment(a.id, { blueprintConfig: { primaryTopicIds: [topicA] } }, USER.id),
      ).rejects.toMatchObject({ status: 409, code: "QM_ASSESSMENT_TOPIC_CONFLICT" });
    });

    it("allows widening back to all topics", async () => {
      const a = await create([topicA]);
      await updateAssessment(a.id, { blueprintConfig: { primaryTopicIds: [] } }, USER.id);
      const row = await prisma.assessments.findUnique({ where: { id: a.id } });
      expect(row.blueprintConfig.primaryTopicIds).toEqual([]);
    });
  });

  describe("questions joining a limited assessment", () => {
    it("acceptance: an assessment limited to two topics only contains those topics", async () => {
      const a = await create([topicA, topicB]);
      const section = await sections.createAssessmentSection(a.id, USER.id, { name: "S" });
      const inA = await makeVariant(topicA, "A");
      const inB = await makeVariant(topicB, "B");
      const inC = await makeVariant(topicC, "C");

      await sections.addVariantToSection(section.id, USER.id, inA.variant.id);
      await sections.addVariantToSection(section.id, USER.id, inB.variant.id);
      await expect(
        sections.addVariantToSection(section.id, USER.id, inC.variant.id),
      ).rejects.toMatchObject({ status: 400, code: "QM_VARIANT_OUTSIDE_ASSESSMENT_TOPICS" });

      const links = await prisma.sectionVariants.findMany({
        where: { section: { assessmentId: a.id } },
        include: { variant: { include: { questionMetadata: true } } },
      });
      const topicsInAssessment = new Set(
        links.map((l) => l.variant.questionMetadata.primaryTopicId),
      );
      expect(topicsInAssessment).toEqual(new Set([topicA, topicB]));
      const cRow = await prisma.variants.findUnique({ where: { id: inC.variant.id } });
      expect(cRow.assessmentId).toBeNull();
    });

    it("an unrestricted assessment still accepts any course question", async () => {
      const a = await create([]);
      const section = await sections.createAssessmentSection(a.id, USER.id, { name: "S" });
      const inC = await makeVariant(topicC);
      await expect(
        sections.addVariantToSection(section.id, USER.id, inC.variant.id),
      ).resolves.toBeTruthy();
    });

    it("rejects creating a variant with assessmentId of a limited assessment", async () => {
      const a = await create([topicA]);
      const { question } = await makeVariant(topicC);
      await expect(
        questions.createVariant(
          question.id,
          { questionText: "new", difficulty: "easy", assessmentId: a.id },
          USER.id,
        ),
      ).rejects.toMatchObject({ status: 400, code: "QM_VARIANT_OUTSIDE_ASSESSMENT_TOPICS" });
    });

    it("rejects moving an existing variant into a limited assessment via update", async () => {
      const a = await create([topicA]);
      const { variant } = await makeVariant(topicC);
      await expect(
        questions.updateVariant(variant.id, { assessmentId: a.id }, USER.id),
      ).rejects.toMatchObject({ status: 400, code: "QM_VARIANT_OUTSIDE_ASSESSMENT_TOPICS" });
    });

    it("refuses a primary-topic change that leaves a limited assessment", async () => {
      const a = await create([topicA]);
      const section = await sections.createAssessmentSection(a.id, USER.id, { name: "S" });
      const { question, variant } = await makeVariant(topicA);
      await sections.addVariantToSection(section.id, USER.id, variant.id);

      const err = await questions
        .updateQuestion(question.id, USER.id, { primaryTopicId: topicC })
        .catch((e) => e);
      expect(err).toMatchObject({ status: 409, code: "QM_ASSESSMENT_TOPIC_CONFLICT" });
      expect(err.details.assessments).toEqual([{ id: a.id, name: "Topic Quiz" }]);
      expect(err.message).toContain('"Topic Quiz"');
      const row = await prisma.questionMetadata.findUnique({ where: { id: question.id } });
      expect(row.primaryTopicId).toBe(topicA);
    });

    it("allows a primary-topic change that stays inside the assessment's topics", async () => {
      const a = await create([topicA, topicB]);
      const section = await sections.createAssessmentSection(a.id, USER.id, { name: "S" });
      const { question, variant } = await makeVariant(topicA);
      await sections.addVariantToSection(section.id, USER.id, variant.id);
      await questions.updateQuestion(question.id, USER.id, { primaryTopicId: topicB });
      const row = await prisma.questionMetadata.findUnique({ where: { id: question.id } });
      expect(row.primaryTopicId).toBe(topicB);
    });

    it("preflights a primary-topic change without writing anything", async () => {
      const a = await create([topicA, topicB]);
      const section = await sections.createAssessmentSection(a.id, USER.id, { name: "S" });
      const { question, variant } = await makeVariant(topicA);
      await sections.addVariantToSection(section.id, USER.id, variant.id);

      const err = await questions
        .checkQuestionTopicChange(question.id, USER.id, topicC)
        .catch((e) => e);
      expect(err).toMatchObject({ status: 409, code: "QM_ASSESSMENT_TOPIC_CONFLICT" });
      expect(err.details.assessments).toEqual([{ id: a.id, name: "Topic Quiz" }]);
      await expect(
        questions.checkQuestionTopicChange(question.id, USER.id, topicB),
      ).resolves.toBeUndefined();
      await expect(
        questions.checkQuestionTopicChange(question.id, USER.id, foreignTopic),
      ).rejects.toThrow();
      const row = await prisma.questionMetadata.findUnique({ where: { id: question.id } });
      expect(row.primaryTopicId).toBe(topicA);
    });
  });
});
