/**
 * Seeds a newly registered user with default courses, topics, and sample questions.
 * Uses the same seed data as development (populateDatabase) and production (seedProductionQuestions).
 */
import { Course, Topics, Question_Metadata, Assessments, Variants } from '../schema/index.js';
import { TOPIC_NAMES_BY_TEMPLATE, SEED_QUESTIONS_BY_TEMPLATE } from '../../scripts/seedData.js';

const NUM_TEMPLATES = TOPIC_NAMES_BY_TEMPLATE.length;

/** Default courses to create for every new user (name, code). Order matches template indices 0..6. */
const DEFAULT_COURSES = [
  { name: 'Machine Architecture', code: 'COSC 211' },
  { name: 'Computer Programming II', code: 'COSC 121' },
  { name: 'Introduction to Statistics', code: 'STUDY1' },
  { name: 'Discrete Math', code: 'STUDY3' },
  { name: 'Introduction to Psychology', code: 'STUDY2' },
  { name: 'Introduction to Nursing', code: 'STUDY4' },
  { name: 'Scientific Research Methods', code: 'STUDY5' }
];

/**
 * Creates the default courses for a user and seeds each with topics, one assessment, and sample questions.
 * @param {number} userId - The new user's id
 * @returns {Promise<{ coursesCreated: number, topicsCreated: number, questionsCreated: number, variantsCreated: number }>}
 */
export async function seedCoursesForNewUser(userId) {
  const courses = await Course.bulkCreate(
    DEFAULT_COURSES.map(({ name, code }) => ({ name, code, userId }))
  );

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
      const topic = await Topics.create({ name, courseId: course.id });
      courseTopics.push(topic);
      topicsCreated++;
    }

    const assessment = await Assessments.create({
      courseId: course.id,
      type: 'Quiz',
      name: 'Practice Exam',
      semester: 'Fall 2026'
    });

    const difficulties = ['easy', 'medium', 'hard'];
    const reasoningLevels = ['factual', 'analytical', 'application'];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const topicIndex = Math.min(q.topicIndex ?? 0, courseTopics.length - 1);
      const primaryTopic = courseTopics[topicIndex];
      const order = { [assessment.id]: i + 1 };

      const meta = await Question_Metadata.create({
        description: q.description,
        type: q.type,
        courseId: course.id,
        primaryTopicId: primaryTopic.id,
        questionOrder: order
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
      await Variants.create(variantPayload);
      variantsCreated++;
    }
  }

  return {
    coursesCreated: courses.length,
    topicsCreated,
    questionsCreated,
    variantsCreated
  };
}
