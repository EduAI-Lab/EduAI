/**
 * TEST-ONLY fixture: seeds a user with default courses, topics, one practice
 * assessment, and sample questions/variants. Used by integration suites that
 * need a realistic, populated course to exercise services/routes against.
 *
 * This used to run on every user's first login (seedNewUserService.js on the
 * QM login path). That runtime seeding was retired — new users now start with
 * zero courses and get real ones through the Core-linked import/link flows.
 * The fixture survives here, invoked explicitly by tests only.
 *
 * Every seeded course gets a deterministic, fake `coreCourseId` so it satisfies
 * the "every QM Course row is Core-linked at creation" invariant, same as the
 * `cuid-*` fixture ids used in coreWiringDb.integration.test.js. After #1114,
 * tests that exercise per-course gates must stub Core enrollment (or the
 * cookie-scoped list) — ownership alone no longer grants access. Prefer
 * `teachingInstructorFetch` from `tests/helpers/teachingInstructorFetch.js`.
 */
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../../src/config/database.js';
import { TOPIC_NAMES_BY_TEMPLATE, SEED_QUESTIONS_BY_TEMPLATE } from '../../scripts/seedData.js';

const NUM_TEMPLATES = TOPIC_NAMES_BY_TEMPLATE.length;

/**
 * Creates `NUM_TEMPLATES` default courses for a user (each linked to a
 * deterministic fake Core course id) and seeds each with topics, one
 * assessment, and sample questions. `name`/`code` are Core-owned and no
 * longer stored locally (#1072 §4 step 10) — the anchor row is just
 * userId + coreCourseId; template selection is by index only.
 * @param {string} userId - The user's id
 * @returns {Promise<{ coursesCreated: number, topicsCreated: number, questionsCreated: number, variantsCreated: number }>}
 */
export async function seedCoursesForNewUser(userId) {
  const courses = [];
  for (let index = 0; index < NUM_TEMPLATES; index++) {
    courses.push(
      await prisma.course.create({
        data: { userId, coreCourseId: `core-seed-course-${userId}-${index}` },
      }),
    );
  }

  let topicsCreated = 0;
  let questionsCreated = 0;
  let variantsCreated = 0;

  for (let courseIndex = 0; courseIndex < courses.length; courseIndex++) {
    const course = courses[courseIndex];
    const templateIndex = courseIndex % NUM_TEMPLATES;
    const topicNames = TOPIC_NAMES_BY_TEMPLATE[templateIndex];
    const questions = SEED_QUESTIONS_BY_TEMPLATE[templateIndex];

    const courseTopics = [];
    for (const name of topicNames) {
      const topic = await prisma.topics.create({ data: { id: createId(), name, courseId: course.id } });
      courseTopics.push(topic);
      topicsCreated++;
    }

    // `semester` no longer exists on `Assessments` (#1072 §4 step 10/#1077).
    const assessment = await prisma.assessments.create({
      data: {
        courseId: course.id,
        type: 'Quiz',
        name: 'Practice Exam'
      }
    });

    const section = await prisma.assessmentSections.create({
      data: {
        assessmentId: assessment.id,
        name: 'Exam',
        description: null,
        position: 0
      }
    });

    const difficulties = ['easy', 'medium', 'hard'];
    const reasoningLevels = ['factual', 'analytical', 'application'];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const topicIndex = Math.min(q.topicIndex ?? 0, courseTopics.length - 1);
      const primaryTopic = courseTopics[topicIndex];
      const order = { [assessment.id]: i + 1 };

      const meta = await prisma.questionMetadata.create({
        data: {
          description: q.description,
          type: q.type,
          courseId: course.id,
          primaryTopicId: primaryTopic.id,
          questionOrder: order
        }
      });
      questionsCreated++;

      const variantPayload = {
        questionText: q.questionText,
        difficulty: difficulties[i % 3],
        reasoningLevel: reasoningLevels[i % 3],
        questionMetadataId: meta.id,
        assessmentId: assessment.id,
        answer: q.type === 'MCQ' && q.correctAnswer ? q.correctAnswer : q.answer,
        isDraft: false,
        isAiGenerated: false
      };
      if (q.type === 'MCQ' && Array.isArray(q.choices) && q.correctAnswer) {
        variantPayload.choices = q.choices.map((c) => ({ letter: c.letter, text: c.text }));
      }
      const variant = await prisma.variants.create({ data: variantPayload });
      variantsCreated++;

      await prisma.sectionVariants.create({
        data: {
          sectionId: section.id,
          variantId: variant.id,
          displayOrder: i
        }
      });
    }
  }

  return {
    coursesCreated: courses.length,
    topicsCreated,
    questionsCreated,
    variantsCreated
  };
}
