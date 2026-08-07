/**
 * Question Maker seed for the unified schema.
 *
 * Authentication and canonical questions live in Core after schema unification.
 * This seed only writes data into QM's own database. All `user_id` columns
 * hold the same Core CUIDs that `apps/core/prisma/seed.ts` writes, and the
 * `core_course_id` / `core_topic_id` / `core_question_id` reference columns
 * point at the matching Core records. Seeding all three apps in order
 * (Core → AI Tutor → QM) yields a fully linked dataset.
 *
 * Run from `apps/extensions/question-maker/app/backend` with:
 *   node scripts/seedUnified.js
 *
 * Truncates every table first — destructive but appropriate for dev /
 * pre-production where no real data exists yet. Assumes migrations have
 * already been applied (`npx prisma migrate deploy`), unlike the old
 * Sequelize version which created tables itself via `sync({ force: true })`.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { createId } from '@paralleldrive/cuid2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../../../');
const envPath = join(projectRoot, '.env');

if (!existsSync(envPath)) {
  console.error(`Error: .env file not found at ${envPath}`);
  process.exit(1);
}

dotenv.config({ path: envPath });

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL must be set in .env');
  process.exit(1);
}

if (process.env.DATABASE_URL.includes('@postgres:')) {
  const isDocker = process.env.DOCKER === 'true' || process.env.COMPOSE_PROJECT_NAME;
  if (!isDocker) {
    const hostPort = process.env.POSTGRES_HOST_PORT || '55432';
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@postgres:5432', `@localhost:${hostPort}`);
  }
}

const { prisma } = await import('../src/config/database.js');
const { truncateAllTables } = await import('../src/utils/truncateAllTables.js');

/**
 * Mirror of `SEED_IDS` from `apps/core/prisma/seed.ts`. Keep in sync with
 * Core's seed; if these drift, cross-app links break silently.
 */
const CORE = {
  users: {
    admin: 'seed_user_admin',
    unitAdminCosc: 'seed_user_unitadmin_cosc',
    unitAdminMulti: 'seed_user_unitadmin_multi',
    instructorCS: 'seed_user_instructor_cs',
    instructorMath: 'seed_user_instructor_math',
    instructorHum: 'seed_user_instructor_hum',
  },
  courses: {
    cosc101: 'seed_course_cosc101',
    cosc121: 'seed_course_cosc121',
    math200: 'seed_course_math200',
    psyo121: 'seed_course_psyo121',
  },
  topic(courseSlug, topicSlug) {
    return `seed_topic_${courseSlug}_${topicSlug}`;
  },
  question(courseSlug, n) {
    return `seed_question_${courseSlug}_${String(n).padStart(2, '0')}`;
  },
};

const USERS = [
  { id: CORE.users.admin, email: 'admin@eduai.local', name: 'EduAI Admin' },
  { id: CORE.users.unitAdminCosc, email: 'unitadmin.cosc@eduai.local', name: 'COSC Unit Admin' },
  { id: CORE.users.unitAdminMulti, email: 'unitadmin.multi@eduai.local', name: 'Multi-Unit Admin' },
  { id: CORE.users.instructorCS, email: 'instructor.cs@eduai.local', name: 'Dr. Ada Lovelace' },
  { id: CORE.users.instructorMath, email: 'instructor.math@eduai.local', name: 'Dr. Emmy Noether' },
  { id: CORE.users.instructorHum, email: 'instructor.hum@eduai.local', name: 'Dr. Hannah Arendt' },
];

/**
 * Each course mirrors a Core course. `coreCourseId` references the Core
 * Course CUID, `topics[].coreTopicSlug` is the slug Core uses for that topic
 * (we reconstruct the Core topic CUID via CORE.topic(courseSlug, topicSlug)).
 *
 * Each question's `coreQuestionN` (if non-null) marks an approved variant
 * whose `core_question_id` points to a real Core Question row.
 */
const COURSES = [
  {
    name: 'Computer Studies',
    code: 'COSC 101',
    coreCourseSlug: 'cosc101',
    coreCourseId: CORE.courses.cosc101,
    ownerId: CORE.users.instructorCS,
    topics: [
      { slug: 'computational_thinking', name: 'Computational Thinking' },
      { slug: 'digital_literacy', name: 'Digital Literacy' },
      { slug: 'data_representation', name: 'Data Representation' },
      { slug: 'algorithms_basics', name: 'Algorithms (Basics)' },
    ],
    assessmentName: 'Midterm Practice',
    questions: [
      {
        description: 'Decomposition definition',
        type: 'MCQ', primaryTopicSlug: 'computational_thinking',
        coreQuestionN: 1,
        variants: [
          {
            text: 'Which of the following best describes "decomposition" in computational thinking?',
            difficulty: 'easy', reasoningLevel: 'factual', isDraft: false,
            answer: 'B',
            choices: [
              { letter: 'A', text: 'Combining many small problems into one' },
              { letter: 'B', text: 'Breaking a complex problem into smaller, manageable parts' },
              { letter: 'C', text: 'Ignoring irrelevant details' },
              { letter: 'D', text: 'Repeating a process many times' },
            ],
            secondaryTopicSlugs: [],
          },
          {
            text: 'A program is broken into modules, each handling a single concern. What technique is this?',
            difficulty: 'easy', reasoningLevel: 'analytical', isDraft: true,
            answer: 'Decomposition',
            choices: null, secondaryTopicSlugs: [],
          },
        ],
      },
      {
        description: 'Bits needed to represent 256 values',
        type: 'MCQ', primaryTopicSlug: 'data_representation',
        coreQuestionN: 2,
        variants: [
          {
            text: 'How many bits are required to represent 256 distinct values?',
            difficulty: 'easy', reasoningLevel: 'analytical', isDraft: false,
            answer: 'C',
            choices: [
              { letter: 'A', text: '4' },
              { letter: 'B', text: '6' },
              { letter: 'C', text: '8' },
              { letter: 'D', text: '16' },
            ],
            secondaryTopicSlugs: [],
          },
        ],
      },
      {
        description: 'Why efficiency matters',
        type: 'SA', primaryTopicSlug: 'algorithms_basics',
        coreQuestionN: 3,
        variants: [
          {
            text: 'Briefly explain why algorithm efficiency matters even when computers are fast.',
            difficulty: 'medium', reasoningLevel: 'analytical', isDraft: false,
            answer: 'As inputs grow, inefficient algorithms scale poorly even on fast machines.',
            choices: null, secondaryTopicSlugs: ['computational_thinking'],
          },
        ],
      },
      {
        description: 'Linear search dominant operation',
        type: 'MCQ', primaryTopicSlug: 'algorithms_basics',
        coreQuestionN: 5,
        variants: [
          {
            text: 'Which operation typically dominates the cost of a simple linear search over n items?',
            difficulty: 'easy', reasoningLevel: 'factual', isDraft: false,
            answer: 'A',
            choices: [
              { letter: 'A', text: 'Constant-time comparison repeated n times' },
              { letter: 'B', text: 'A single hash lookup' },
              { letter: 'C', text: 'Sorting the list first' },
              { letter: 'D', text: 'Logarithmic partitioning' },
            ],
            secondaryTopicSlugs: [],
          },
        ],
      },
    ],
  },
  {
    name: 'Computer Programming II',
    code: 'COSC 121',
    coreCourseSlug: 'cosc121',
    coreCourseId: CORE.courses.cosc121,
    ownerId: CORE.users.instructorCS,
    topics: [
      { slug: 'oop', name: 'Object-Oriented Design' },
      { slug: 'ds_fundamentals', name: 'Data Structures Fundamentals' },
      { slug: 'algorithm_analysis', name: 'Algorithm Analysis' },
      { slug: 'testing', name: 'Testing and Debugging' },
      { slug: 'recursion', name: 'Recursion Patterns' },
    ],
    assessmentName: 'Final Practice',
    questions: [
      {
        description: 'Arrays vs linked lists',
        type: 'SA', primaryTopicSlug: 'ds_fundamentals',
        coreQuestionN: 1,
        variants: [
          {
            text: 'Compare arrays and linked lists. When would you choose a linked list over an array?',
            difficulty: 'medium', reasoningLevel: 'analytical', isDraft: false,
            answer: 'Frequent insert/remove dominates, dynamic size, no random access by index.',
            choices: null, secondaryTopicSlugs: [],
          },
        ],
      },
      {
        description: 'Recursive binary search',
        type: 'SA', primaryTopicSlug: 'recursion',
        coreQuestionN: 2,
        variants: [
          {
            text: 'Describe a recursive implementation of binary search. State the base case.',
            difficulty: 'medium', reasoningLevel: 'application', isDraft: false,
            answer: 'Base case: empty range. Recursive case: compare midpoint, recurse on one half. O(log n).',
            choices: null, secondaryTopicSlugs: ['algorithm_analysis'],
          },
        ],
      },
      {
        description: 'When to write tests (TDD)',
        type: 'MCQ', primaryTopicSlug: 'testing',
        coreQuestionN: 3,
        variants: [
          {
            text: 'In test-driven development, when do you write the unit tests?',
            difficulty: 'easy', reasoningLevel: 'factual', isDraft: false,
            answer: 'B',
            choices: [
              { letter: 'A', text: 'After the code is complete' },
              { letter: 'B', text: 'Before writing the implementation' },
              { letter: 'C', text: 'Only for bug fixes' },
              { letter: 'D', text: 'Only for public APIs' },
            ],
            secondaryTopicSlugs: [],
          },
        ],
      },
      {
        description: 'Encapsulation example',
        type: 'LA', primaryTopicSlug: 'oop',
        coreQuestionN: 5,
        variants: [
          {
            text: 'Explain encapsulation and give an example where breaking it leads to a bug.',
            difficulty: 'hard', reasoningLevel: 'application', isDraft: false,
            answer: 'Encapsulation hides internal state behind a stable interface; exposing internals can break invariants.',
            choices: null, secondaryTopicSlugs: [],
          },
          {
            // Draft variant — has no core_question_id since it has not been pushed yet.
            text: 'Refactor a class that exposes a mutable internal list and explain the fix.',
            difficulty: 'hard', reasoningLevel: 'application', isDraft: true,
            answer: null, choices: null, secondaryTopicSlugs: [],
          },
        ],
      },
    ],
  },
  {
    name: 'Calculus III',
    code: 'MATH 200',
    coreCourseSlug: 'math200',
    coreCourseId: CORE.courses.math200,
    ownerId: CORE.users.instructorMath,
    topics: [
      { slug: 'partials', name: 'Partial Derivatives' },
      { slug: 'multiple_integrals', name: 'Multiple Integrals' },
      { slug: 'vector_fields', name: 'Vector Fields' },
      { slug: 'greens_stokes', name: 'Greens, Stokes, and Divergence' },
    ],
    assessmentName: 'Quiz 1',
    questions: [
      {
        description: 'Partial derivative definition',
        type: 'SA', primaryTopicSlug: 'partials',
        coreQuestionN: 1,
        variants: [
          {
            text: 'State the definition of the partial derivative of f(x, y) with respect to x at (a, b).',
            difficulty: 'easy', reasoningLevel: 'factual', isDraft: false,
            answer: 'f_x(a,b) = lim_{h->0} [f(a+h, b) - f(a, b)] / h, holding y constant.',
            choices: null, secondaryTopicSlugs: [],
          },
        ],
      },
      {
        description: 'Conservative field characterization',
        type: 'MCQ', primaryTopicSlug: 'vector_fields',
        coreQuestionN: 3,
        variants: [
          {
            text: 'A vector field F is conservative if and only if:',
            difficulty: 'medium', reasoningLevel: 'analytical', isDraft: false,
            answer: 'B',
            choices: [
              { letter: 'A', text: 'div F = 0' },
              { letter: 'B', text: 'F = grad(phi) on a simply connected domain' },
              { letter: 'C', text: 'curl F is nonzero' },
              { letter: 'D', text: 'F has constant magnitude' },
            ],
            secondaryTopicSlugs: [],
          },
        ],
      },
      {
        description: 'Greens theorem statement',
        type: 'MCQ', primaryTopicSlug: 'greens_stokes',
        coreQuestionN: 4,
        variants: [
          {
            text: 'Greens theorem relates a line integral around a simple closed curve to:',
            difficulty: 'medium', reasoningLevel: 'factual', isDraft: false,
            answer: 'B',
            choices: [
              { letter: 'A', text: 'A surface integral over an arbitrary surface' },
              { letter: 'B', text: 'A double integral over the enclosed region' },
              { letter: 'C', text: 'A volume integral over the enclosed solid' },
              { letter: 'D', text: 'Another line integral over the same curve' },
            ],
            secondaryTopicSlugs: [],
          },
        ],
      },
    ],
  },
  {
    name: 'Introduction to Psychology',
    code: 'PSYO 121',
    coreCourseSlug: 'psyo121',
    coreCourseId: CORE.courses.psyo121,
    ownerId: CORE.users.instructorHum,
    topics: [
      { slug: 'brain', name: 'Brain and Behavior' },
      { slug: 'learning', name: 'Learning' },
      { slug: 'memory', name: 'Memory' },
      { slug: 'social', name: 'Social Psychology' },
    ],
    assessmentName: 'Practice Set',
    questions: [
      {
        description: 'Classical vs operant conditioning',
        type: 'SA', primaryTopicSlug: 'learning',
        coreQuestionN: 1,
        variants: [
          {
            text: 'Distinguish classical conditioning from operant conditioning with one example each.',
            difficulty: 'medium', reasoningLevel: 'factual', isDraft: false,
            answer: 'Classical: stimulus pairing (Pavlov). Operant: behavior shaped by consequences (Skinner).',
            choices: null, secondaryTopicSlugs: [],
          },
        ],
      },
      {
        description: 'Hippocampus role',
        type: 'MCQ', primaryTopicSlug: 'brain',
        coreQuestionN: 2,
        variants: [
          {
            text: 'Which brain structure is most associated with the consolidation of long-term memories?',
            difficulty: 'easy', reasoningLevel: 'factual', isDraft: false,
            answer: 'B',
            choices: [
              { letter: 'A', text: 'Cerebellum' },
              { letter: 'B', text: 'Hippocampus' },
              { letter: 'C', text: 'Brainstem' },
              { letter: 'D', text: 'Pineal gland' },
            ],
            secondaryTopicSlugs: ['memory'],
          },
        ],
      },
    ],
  },
];

async function seed() {
  console.log('Connecting to database...');
  await prisma.$queryRaw`SELECT 1`;
  console.log('Database connection established.');

  console.log('Truncating tables...');
  await truncateAllTables(prisma);
  console.log('Tables truncated.');

  console.log('Seeding users...');
  await prisma.user.createMany({ data: USERS });

  let courseCount = 0;
  let topicCount = 0;
  let metadataCount = 0;
  let variantCount = 0;
  let linkedVariantCount = 0;

  for (const course of COURSES) {
    // `name`/`code` are Core-owned and no longer stored locally (#1072 §4
    // step 10) — the anchor row is just userId + coreCourseId; `course.name`/
    // `course.code` above stay in this file's own COURSES literal purely as
    // seed-data documentation.
    const createdCourse = await prisma.course.create({
      data: {
        userId: course.ownerId,
        coreCourseId: course.coreCourseId,
      },
    });
    courseCount += 1;

    const topicBySlug = new Map();
    for (const topic of course.topics) {
      const created = await prisma.topics.create({
        data: {
          id: createId(),
          name: topic.name,
          courseId: createdCourse.id,
          coreTopicId: CORE.topic(course.coreCourseSlug, topic.slug),
        },
      });
      topicBySlug.set(topic.slug, created);
      topicCount += 1;
    }

    // `semester` no longer exists on `Assessments` (#1072 §4 step 10/#1077) —
    // it's derived from the course's Core term at the read seam.
    const assessment = await prisma.assessments.create({
      data: {
        courseId: createdCourse.id,
        type: 'Quiz',
        name: course.assessmentName,
      },
    });

    for (const [qIdx, question] of course.questions.entries()) {
      const primaryTopic = topicBySlug.get(question.primaryTopicSlug);
      if (!primaryTopic) {
        throw new Error(`Unknown primary topic slug ${question.primaryTopicSlug} in ${course.code}`);
      }

      const metadata = await prisma.questionMetadata.create({
        data: {
          description: question.description,
          type: question.type,
          courseId: createdCourse.id,
          primaryTopicId: primaryTopic.id,
          questionOrder: { [assessment.id]: qIdx + 1 },
        },
      });
      metadataCount += 1;

      for (const variant of question.variants) {
        const secondaryTopicIds = variant.secondaryTopicSlugs
          .map((slug) => topicBySlug.get(slug)?.id)
          .filter(Boolean);

        // Only non-draft variants get a Core link, mirroring runtime behaviour.
        const coreQuestionId =
          !variant.isDraft && question.coreQuestionN
            ? CORE.question(course.coreCourseSlug, question.coreQuestionN)
            : null;

        await prisma.variants.create({
          data: {
            questionText: variant.text,
            difficulty: variant.difficulty,
            reasoningLevel: variant.reasoningLevel,
            questionMetadataId: metadata.id,
            assessmentId: assessment.id,
            secondaryTopicsId: secondaryTopicIds,
            isAiGenerated: false,
            isDraft: variant.isDraft,
            answer: variant.answer,
            choices: variant.choices,
            coreQuestionId,
          },
        });
        variantCount += 1;
        if (coreQuestionId) linkedVariantCount += 1;
      }
    }
  }

  console.log(
    `Seed complete — ${USERS.length} users, ${courseCount} courses, ${topicCount} topics, ` +
      `${metadataCount} question_metadata rows, ${variantCount} variants ` +
      `(${linkedVariantCount} linked to Core via core_question_id)`,
  );
}

seed()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
