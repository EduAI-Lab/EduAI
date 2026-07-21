import { Prisma, PrismaClient } from '@prisma/client';

/**
 * AI Tutor seed.
 *
 * Identity is owned by Core after schema unification — this seed only writes
 * data into AI Tutor's own database. All `userId` columns hold the same Core
 * CUIDs that `apps/core/prisma/seed.ts` writes, so the two seeds together
 * produce a linked dataset that exercises the full cross-app flow.
 *
 * To stay in sync without a runtime import (Core is a separate project), the
 * Core seed IDs are duplicated here. If Core's `SEED_IDS` change, update
 * `CORE` below.
 */
const CORE = {
  users: {
    instructorCS: 'seed_user_instructor_cs',
    instructorMath: 'seed_user_instructor_math',
    taCS: 'seed_user_ta_cs',
    student1: 'seed_user_student_01',
    student2: 'seed_user_student_02',
    student3: 'seed_user_student_03',
    student4: 'seed_user_student_04',
    student5: 'seed_user_student_05',
  },
  courses: {
    cosc101: 'seed_course_cosc101',
    cosc121: 'seed_course_cosc121',
    math200: 'seed_course_math200',
  },
  topic(courseSlug: string, topicSlug: string) {
    return `seed_topic_${courseSlug}_${topicSlug}`;
  },
} as const;

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Prompt templates and system prompts (REQUIRED for runtime)
// ---------------------------------------------------------------------------

async function seedPromptTemplates() {
  // The slugs below are referenced by name in the AI dual-loop. Renaming or
  // deleting any of them will break chat at runtime.
  const templates = [
    {
      slug: 'learning-prompt',
      name: 'Learning Prompt',
      temperature: 0.7,
      topP: 0.9,
      systemPrompt: `You are a friendly tutor who is eager to help students learn by asking questions and providing examples. You are going to help students learn about [INSERT TOPIC HERE]. You will do this by asking what the students' knowledge level is and depending on the student's level you will adjust your teaching style. You will give examples and slowly introduce the topic to the student while asking them if they have any questions between each section. Assume you are speaking to a university student.

Give the students examples and explanations. If the student is struggling, don't give them the answer; instead give them different ways to think about the topic or introduce other examples. Have them repeat the current subject back to you in their own words to check understanding.`,
    },
    {
      slug: 'exercise-prompt',
      name: 'Exercise Prompt',
      temperature: 0.7,
      topP: 0.9,
      systemPrompt: `You are a friendly tutor who is eager to help students learn by asking questions and providing examples. A student is going to send you a code snippet, and you will help them solve it. You will give them advice and guidance but not the answer directly. Teach them about the topic at hand and try to have them figure out the answer for themselves.`,
    },
    {
      slug: 'supervisor-prompt',
      name: 'Supervisor Prompt',
      temperature: 0.1,
      topP: 0.9,
      systemPrompt: `You are a pedagogical supervisor reviewing a tutor's response to a student.

RULES the tutor MUST follow:
1. NEVER directly reveal answers, solutions, or correct options
2. Guide via questions, hints, analogies — not direct statements
3. Never explicitly confirm "correct" or "incorrect"
4. Be encouraging but don't do the thinking for the student
5. If student asks for the answer directly, redirect them to think critically

Respond with ONLY valid JSON (no markdown, no extra text):
{"approved": true}
OR
{"approved": false, "reason": "brief explanation", "feedbackToTutor": "how to improve", "safeResponseToStudent": "a safe, student-facing fallback that does not reveal the answer"}`,
    },
  ];

  const result: Record<string, number> = {};
  for (const t of templates) {
    const row = await prisma.promptTemplate.upsert({
      where: { slug: t.slug },
      update: {
        name: t.name,
        systemPrompt: t.systemPrompt,
        temperature: t.temperature,
        topP: t.topP,
        isActive: true,
      },
      create: { ...t, isActive: true },
    });
    result[t.slug] = row.id;
  }
  return result;
}

async function seedSystemPrompts() {
  await prisma.systemPrompt.upsert({
    where: { slug: 'global-activity-base' },
    update: {
      content: `You are a concise teaching assistant. Provide brief, actionable guidance in 2-3 sentences (under 50 words).

Keep responses extremely short and focused. The student cannot reply, so give one clear hint or insight they can act on immediately.`,
    },
    create: {
      slug: 'global-activity-base',
      content: `You are a concise teaching assistant. Provide brief, actionable guidance in 2-3 sentences (under 50 words).

Keep responses extremely short and focused. The student cannot reply, so give one clear hint or insight they can act on immediately.`,
    },
  });
}

async function seedSuggestedPrompts() {
  const prompts = [
    { mode: 'teach', text: 'Can you explain this concept in simpler terms?', position: 1 },
    { mode: 'teach', text: 'What are the key things I should understand about this topic?', position: 2 },
    { mode: 'teach', text: 'Can you give me an example to help me understand?', position: 3 },
    { mode: 'teach', text: 'Why is this concept important?', position: 4 },
    { mode: 'guide', text: "I'm stuck, can you give me a hint?", position: 1 },
    { mode: 'guide', text: 'What should I think about to solve this?', position: 2 },
    { mode: 'guide', text: 'Am I on the right track with my approach?', position: 3 },
    { mode: 'guide', text: 'What concept should I review to answer this?', position: 4 },
  ];

  await prisma.suggestedPrompt.deleteMany();
  await prisma.suggestedPrompt.createMany({
    data: prompts.map((p) => ({ ...p, isActive: true })),
  });
}

async function seedSystemSettings() {
  await prisma.systemSetting.upsert({
    where: { key: 'AI_MODEL_POLICY' },
    update: {
      value: JSON.stringify({
        teach: { tutorModel: 'gpt-4o', supervisorModel: 'gpt-4o-mini', maxIterations: 2 },
        guide: { tutorModel: 'gpt-4o-mini', supervisorModel: 'gpt-4o-mini', maxIterations: 1 },
      }),
    },
    create: {
      key: 'AI_MODEL_POLICY',
      value: JSON.stringify({
        teach: { tutorModel: 'gpt-4o', supervisorModel: 'gpt-4o-mini', maxIterations: 2 },
        guide: { tutorModel: 'gpt-4o-mini', supervisorModel: 'gpt-4o-mini', maxIterations: 1 },
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Course content linked to Core
// ---------------------------------------------------------------------------

type ActivityFixture = {
  title: string;
  instructions: string;
  mainTopicSlug: string;
  secondaryTopicSlugs?: string[];
  config: Prisma.InputJsonObject;
};

type LessonFixture = {
  title: string;
  contentMd: string;
  activities: ActivityFixture[];
};

type ModuleFixture = {
  title: string;
  description: string;
  lessons: LessonFixture[];
};

type CourseFixture = {
  /** Local-only label; Core does not see this. */
  internalKey: string;
  /** Core CUID — this offering imports from this Core course. */
  coreCourseId: string;
  /** Core CUID of the primary instructor (mirrors Core seed). */
  instructorId: string;
  /** Core CUIDs of students to enroll (subset of seed students). */
  studentIds: string[];
  /** Maps topic slug → Core topic CUID (same slugs Core seeds). */
  topics: { slug: string; name: string; coreTopicSlug: string }[];
  modules: ModuleFixture[];
};

const COURSE_FIXTURES: CourseFixture[] = [
  {
    internalKey: 'cosc101',
    coreCourseId: CORE.courses.cosc101,
    instructorId: CORE.users.instructorCS,
    studentIds: [CORE.users.student1, CORE.users.student2, CORE.users.student3],
    topics: [
      { slug: 'computational_thinking', name: 'Computational Thinking', coreTopicSlug: 'computational_thinking' },
      { slug: 'digital_literacy', name: 'Digital Literacy', coreTopicSlug: 'digital_literacy' },
      { slug: 'data_representation', name: 'Data Representation', coreTopicSlug: 'data_representation' },
      { slug: 'algorithms_basics', name: 'Algorithms (Basics)', coreTopicSlug: 'algorithms_basics' },
    ],
    modules: [
      {
        title: 'Module 1 — Foundations',
        description: 'How computers represent and process information.',
        lessons: [
          {
            title: 'Lesson 1.1 — Thinking Computationally',
            contentMd: '# Computational thinking\n\nDecomposition, pattern recognition, abstraction, and algorithms.',
            activities: [
              {
                title: 'Decomposition warm-up',
                instructions: 'Identify the sub-problems in a planning task.',
                mainTopicSlug: 'computational_thinking',
                config: {
                  question: 'Which of the following best describes "decomposition" in computational thinking?',
                  questionType: 'MCQ',
                  options: [
                    'Combining many small problems into one',
                    'Breaking a complex problem into smaller, manageable parts',
                    'Ignoring irrelevant details',
                    'Repeating a process many times',
                  ],
                  answer: { correctIndex: 1 },
                  hints: ['Think about how you would tackle a research paper.'],
                },
              },
              {
                title: 'Bits and bytes',
                instructions: 'Count the bits needed.',
                mainTopicSlug: 'data_representation',
                config: {
                  question: 'How many bits are required to represent 256 distinct values?',
                  questionType: 'MCQ',
                  options: ['4', '6', '8', '16'],
                  answer: { correctIndex: 2 },
                  hints: ['256 is a power of two.'],
                },
              },
            ],
          },
          {
            title: 'Lesson 1.2 — Algorithms in Everyday Life',
            contentMd: '# Algorithms\n\nThey are not just for computers — recipes are algorithms too.',
            activities: [
              {
                title: 'Why efficiency matters',
                instructions: 'Explain in your own words.',
                mainTopicSlug: 'algorithms_basics',
                secondaryTopicSlugs: ['computational_thinking'],
                config: {
                  question: 'Briefly explain why algorithm efficiency matters even when computers are fast.',
                  questionType: 'SHORT_TEXT',
                  answer: { text: 'Inputs grow; inefficient algorithms scale poorly even on fast machines.' },
                  hints: ['Consider what happens when n doubles.'],
                },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    internalKey: 'cosc121',
    coreCourseId: CORE.courses.cosc121,
    instructorId: CORE.users.instructorCS,
    studentIds: [CORE.users.student1, CORE.users.student2, CORE.users.student4, CORE.users.student5],
    topics: [
      { slug: 'oop', name: 'Object-Oriented Design', coreTopicSlug: 'oop' },
      { slug: 'ds_fundamentals', name: 'Data Structures Fundamentals', coreTopicSlug: 'ds_fundamentals' },
      { slug: 'algorithm_analysis', name: 'Algorithm Analysis', coreTopicSlug: 'algorithm_analysis' },
      { slug: 'testing', name: 'Testing and Debugging', coreTopicSlug: 'testing' },
      { slug: 'recursion', name: 'Recursion Patterns', coreTopicSlug: 'recursion' },
    ],
    modules: [
      {
        title: 'Module 1 — Data Structures',
        description: 'Linear and recursive structures.',
        lessons: [
          {
            title: 'Lesson 1.1 — Arrays vs Linked Lists',
            contentMd: '# Trade-offs\n\nRandom access vs efficient insertion.',
            activities: [
              {
                title: 'Pick the right structure',
                instructions: 'Compare and contrast.',
                mainTopicSlug: 'ds_fundamentals',
                config: {
                  question: 'When would you choose a linked list over an array?',
                  questionType: 'SHORT_TEXT',
                  answer: { text: 'Frequent insert/remove at known positions, dynamic size, no random access by index.' },
                  hints: ['Think about what each structure is O(1) at.'],
                },
              },
            ],
          },
          {
            title: 'Lesson 1.2 — Binary Search',
            contentMd: '# Divide and conquer',
            activities: [
              {
                title: 'Recursive binary search',
                instructions: 'Describe the base case.',
                mainTopicSlug: 'recursion',
                secondaryTopicSlugs: ['algorithm_analysis'],
                config: {
                  question: 'Describe a recursive implementation of binary search. State the base case.',
                  questionType: 'SHORT_TEXT',
                  answer: { text: 'Base case: empty range. Recursive case: compare midpoint, recurse on one half. O(log n).' },
                  hints: ['What is the smallest interesting input?'],
                },
              },
            ],
          },
        ],
      },
      {
        title: 'Module 2 — Testing',
        description: 'How we know our code works.',
        lessons: [
          {
            title: 'Lesson 2.1 — Test-Driven Development',
            contentMd: '# TDD\n\nRed, green, refactor.',
            activities: [
              {
                title: 'When to write tests',
                instructions: 'Pick the TDD definition.',
                mainTopicSlug: 'testing',
                config: {
                  question: 'In TDD, when do you write the unit tests?',
                  questionType: 'MCQ',
                  options: [
                    'After the code is complete',
                    'Before writing the implementation',
                    'Only for bug fixes',
                    'Only for public APIs',
                  ],
                  answer: { correctIndex: 1 },
                  hints: ['T stands for "test"; D stands for "driven".'],
                },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    internalKey: 'math200',
    coreCourseId: CORE.courses.math200,
    instructorId: CORE.users.instructorMath,
    studentIds: [CORE.users.student3, CORE.users.student4, CORE.users.student5],
    topics: [
      { slug: 'partials', name: 'Partial Derivatives', coreTopicSlug: 'partials' },
      { slug: 'multiple_integrals', name: 'Multiple Integrals', coreTopicSlug: 'multiple_integrals' },
      { slug: 'vector_fields', name: 'Vector Fields', coreTopicSlug: 'vector_fields' },
    ],
    modules: [
      {
        title: 'Module 1 — Partial Derivatives',
        description: 'Differentiating multivariable functions.',
        lessons: [
          {
            title: 'Lesson 1.1 — Definition',
            contentMd: '# Partial derivatives',
            activities: [
              {
                title: 'State the definition',
                instructions: 'Recall the formal definition.',
                mainTopicSlug: 'partials',
                config: {
                  question: 'State the definition of the partial derivative of f(x, y) with respect to x at (a, b).',
                  questionType: 'SHORT_TEXT',
                  answer: { text: 'f_x(a,b) = lim_{h->0} [f(a+h, b) - f(a, b)] / h, holding y constant.' },
                  hints: ['Treat y as a constant.'],
                },
              },
            ],
          },
        ],
      },
      {
        title: 'Module 2 — Vector Calculus',
        description: 'Beyond scalar functions.',
        lessons: [
          {
            title: 'Lesson 2.1 — Conservative Fields',
            contentMd: '# Conservative vector fields',
            activities: [
              {
                title: 'Conservative iff gradient',
                instructions: 'Recall the equivalence.',
                mainTopicSlug: 'vector_fields',
                config: {
                  question: 'A vector field F is conservative if and only if:',
                  questionType: 'MCQ',
                  options: [
                    'div F = 0',
                    'F = grad(phi) on a simply connected domain',
                    'curl F is nonzero',
                    'F has constant magnitude',
                  ],
                  answer: { correctIndex: 1 },
                  hints: ['Think about the fundamental theorem for line integrals.'],
                },
              },
            ],
          },
        ],
      },
    ],
  },
];

async function seedCourses(promptTemplateIds: Record<string, number>) {
  type SeededActivity = { id: number; title: string | null };
  const allActivities: { offeringId: number; activities: SeededActivity[] }[] = [];

  for (const course of COURSE_FIXTURES) {
    // Idempotent: look up by coreOfferingId first.
    let offering = await prisma.courseOffering.findUnique({
      where: { coreOfferingId: course.coreCourseId },
    });

    if (offering) {
      // Wipe and rebuild content for a clean seed.
      const moduleIds = await prisma.module.findMany({
        where: { courseOfferingId: offering.id },
        select: { id: true },
      });
      const lessonIds = await prisma.lesson.findMany({
        where: { moduleId: { in: moduleIds.map((m) => m.id) } },
        select: { id: true },
      });
      const activityIds = await prisma.activity.findMany({
        where: { lessonId: { in: lessonIds.map((l) => l.id) } },
        select: { id: true },
      });
      await prisma.activitySecondaryTopic.deleteMany({
        where: { activityId: { in: activityIds.map((a) => a.id) } },
      });
      await prisma.submission.deleteMany({
        where: { activityId: { in: activityIds.map((a) => a.id) } },
      });
      await prisma.activityFeedback.deleteMany({
        where: { activityId: { in: activityIds.map((a) => a.id) } },
      });
      await prisma.activityStudentMetric.deleteMany({
        where: { activityId: { in: activityIds.map((a) => a.id) } },
      });
      await prisma.activityAnalytics.deleteMany({
        where: { activityId: { in: activityIds.map((a) => a.id) } },
      });
      await prisma.aiInteractionTrace.deleteMany({
        where: { activityId: { in: activityIds.map((a) => a.id) } },
      });
      await prisma.aiChatSession.deleteMany({
        where: { activityId: { in: activityIds.map((a) => a.id) } },
      });
      await prisma.activity.deleteMany({
        where: { id: { in: activityIds.map((a) => a.id) } },
      });
      await prisma.lesson.deleteMany({ where: { id: { in: lessonIds.map((l) => l.id) } } });
      await prisma.module.deleteMany({ where: { id: { in: moduleIds.map((m) => m.id) } } });
      await prisma.topic.deleteMany({ where: { courseOfferingId: offering.id } });

      // #1072 step 4: `offering` is a pure anchor row — it was already found
      // by `coreOfferingId`, so there is nothing left to update. Every real
      // field (title/description/dates/isPublished/department) is Core-owned
      // and read-through via `mapCourseOffering`; this seed never writes any
      // of them onto the local row.
    } else {
      offering = await prisma.courseOffering.create({
        data: {
          coreOfferingId: course.coreCourseId,
        },
      });
    }

    // Upsert the primary instructor link so they can manage the course.
    await prisma.courseInstructor.upsert({
      where: {
        userId_courseOfferingId: {
          userId: course.instructorId,
          courseOfferingId: offering.id,
        },
      },
      create: { courseOfferingId: offering.id, userId: course.instructorId, role: 'LEAD' },
      update: {},
    });

    // Upsert student enrollments so the student shell shows these courses.
    for (const studentId of course.studentIds) {
      await prisma.courseEnrollment.upsert({
        where: {
          courseOfferingId_userId: {
            courseOfferingId: offering.id,
            userId: studentId,
          },
        },
        create: { courseOfferingId: offering.id, userId: studentId, role: 'STUDENT' },
        update: {},
      });
    }

    const topicIdBySlug = new Map<string, string>();
    for (const topic of course.topics) {
      const created = await prisma.topic.create({
        data: {
          name: topic.name,
          courseOfferingId: offering.id,
          coreTopicId: CORE.topic(course.internalKey, topic.coreTopicSlug),
        },
      });
      topicIdBySlug.set(topic.slug, created.id);
    }

    const seededActivities: SeededActivity[] = [];

    for (const [modIdx, mod] of course.modules.entries()) {
      const createdModule = await prisma.module.create({
        data: {
          title: mod.title,
          description: mod.description,
          position: modIdx + 1,
          isPublished: true,
          courseOfferingId: offering.id,
        },
      });

      for (const [lessonIdx, lesson] of mod.lessons.entries()) {
        const createdLesson = await prisma.lesson.create({
          data: {
            title: lesson.title,
            contentMd: lesson.contentMd,
            position: lessonIdx + 1,
            isPublished: true,
            moduleId: createdModule.id,
          },
        });

        for (const [actIdx, activity] of lesson.activities.entries()) {
          const mainTopicId = topicIdBySlug.get(activity.mainTopicSlug);
          if (!mainTopicId) throw new Error(`Unknown topic slug: ${activity.mainTopicSlug}`);

          const secondaryIds = (activity.secondaryTopicSlugs ?? [])
            .map((slug) => topicIdBySlug.get(slug))
            .filter((id): id is string => Boolean(id) && id !== mainTopicId);

          const created = await prisma.activity.create({
            data: {
              title: activity.title,
              instructionsMd: activity.instructions,
              position: actIdx + 1,
              lessonId: createdLesson.id,
              promptTemplateId: promptTemplateIds['learning-prompt'],
              config: activity.config,
              mainTopicId,
              enableTeachMode: true,
              enableGuideMode: true,
              enableCustomMode: false,
              secondaryTopics: secondaryIds.length
                ? { create: secondaryIds.map((topicId) => ({ topic: { connect: { id: topicId } } })) }
                : undefined,
            },
          });
          seededActivities.push({ id: created.id, title: created.title });
        }
      }
    }

    allActivities.push({ offeringId: offering.id, activities: seededActivities });
  }

  return allActivities;
}

// ---------------------------------------------------------------------------
// Student-facing data: submissions, feedback, metrics, analytics, sessions
// ---------------------------------------------------------------------------

async function seedLearnerData(
  offerings: { offeringId: number; activities: { id: number; title: string | null }[] }[],
) {
  const allActivities = offerings.flatMap((o) => o.activities);
  if (allActivities.length === 0) return;

  // For each of the first ~5 activities across courses, attach a couple of
  // submissions, a feedback row, and a metric row so dashboards have data.
  const learners = [
    CORE.users.student1,
    CORE.users.student2,
    CORE.users.student3,
    CORE.users.student4,
    CORE.users.student5,
  ];

  for (const [idx, activity] of allActivities.entries()) {
    const learner = learners[idx % learners.length];
    const learner2 = learners[(idx + 1) % learners.length];

    // First attempt — incorrect.
    await prisma.submission.create({
      data: {
        attemptNumber: 1,
        response: { text: 'first attempt — unsure' },
        isCorrect: false,
        score: 0,
        userId: learner,
        activityId: activity.id,
      },
    });
    // Second attempt — correct.
    await prisma.submission.create({
      data: {
        attemptNumber: 2,
        response: { text: 'second attempt — corrected after a hint' },
        isCorrect: true,
        score: 1,
        userId: learner,
        activityId: activity.id,
      },
    });

    // Another student, single correct attempt.
    await prisma.submission.create({
      data: {
        attemptNumber: 1,
        response: { text: 'got it on the first try' },
        isCorrect: true,
        score: 1,
        userId: learner2,
        activityId: activity.id,
      },
    });

    await prisma.activityFeedback.upsert({
      where: { userId_activityId: { userId: learner, activityId: activity.id } },
      update: { rating: 4, note: 'Helpful, especially the hint after the first wrong attempt.' },
      create: {
        rating: 4,
        note: 'Helpful, especially the hint after the first wrong attempt.',
        userId: learner,
        activityId: activity.id,
      },
    });

    await prisma.activityStudentMetric.upsert({
      where: { userId_activityId: { userId: learner, activityId: activity.id } },
      update: {
        helpRequestCount: 1,
        submissionCount: 2,
        incorrectSubmissionCount: 1,
        correctSubmissionCount: 1,
      },
      create: {
        helpRequestCount: 1,
        submissionCount: 2,
        incorrectSubmissionCount: 1,
        correctSubmissionCount: 1,
        userId: learner,
        activityId: activity.id,
      },
    });

    await prisma.activityStudentMetric.upsert({
      where: { userId_activityId: { userId: learner2, activityId: activity.id } },
      update: {
        helpRequestCount: 0,
        submissionCount: 1,
        incorrectSubmissionCount: 0,
        correctSubmissionCount: 1,
      },
      create: {
        helpRequestCount: 0,
        submissionCount: 1,
        incorrectSubmissionCount: 0,
        correctSubmissionCount: 1,
        userId: learner2,
        activityId: activity.id,
      },
    });

    await prisma.activityAnalytics.upsert({
      where: { activityId: activity.id },
      update: {
        helpRequestCount: 1,
        submissionCount: 3,
        incorrectSubmissionCount: 1,
        correctSubmissionCount: 2,
        studentCount: 2,
        feedbackCount: 1,
        averageRating: 4,
        difficultyScore: 30,
        difficultyLabel: 'LOW',
      },
      create: {
        helpRequestCount: 1,
        submissionCount: 3,
        incorrectSubmissionCount: 1,
        correctSubmissionCount: 2,
        studentCount: 2,
        feedbackCount: 1,
        averageRating: 4,
        difficultyScore: 30,
        difficultyLabel: 'LOW',
        activityId: activity.id,
      },
    });

    // A "teach" chat session and one interaction trace.
    const seedChatId = `seed_chat_${activity.id}_${learner}`;
    const existingSession = await prisma.aiChatSession.findFirst({
      where: { chatId: seedChatId },
    });
    const session =
      existingSession ??
      (await prisma.aiChatSession.create({
        data: {
          userId: learner,
          activityId: activity.id,
          mode: 'teach',
          chatId: seedChatId,
          modelId: 'gpt-4o',
        },
      }));

    await prisma.aiInteractionTrace.create({
      data: {
        mode: 'teach',
        knowledgeLevel: 'beginner',
        chatId: session.chatId,
        tutorModelId: 'gpt-4o',
        supervisorModelId: 'gpt-4o-mini',
        userMessage: "I'm not sure how to start.",
        finalResponse: "Let's break the problem into smaller parts. What is the first sub-problem?",
        finalOutcome: 'approved',
        iterationCount: 1,
        trace: {
          attempts: [
            {
              tutorDraft: 'Here is the answer: ...',
              supervisorVerdict: { approved: false, reason: 'Revealed the answer' },
            },
            {
              tutorDraft: "Let's break the problem into smaller parts. What is the first sub-problem?",
              supervisorVerdict: { approved: true },
            },
          ],
        },
        userId: learner,
        activityId: activity.id,
        aiChatSessionId: session.id,
      },
    });
  }
}

async function main() {
  console.log('Seeding AI Tutor...');

  const promptTemplateIds = await seedPromptTemplates();
  console.log('  Prompt templates seeded');

  await seedSystemPrompts();
  await seedSuggestedPrompts();
  await seedSystemSettings();
  console.log('  System prompts, suggested prompts, and settings seeded');

  const offerings = await seedCourses(promptTemplateIds);
  console.log(
    `  ${offerings.length} course offerings linked to Core (coreOfferingId set)`,
  );

  await seedLearnerData(offerings);
  console.log('  Learner submissions, feedback, metrics, analytics, and AI chat traces seeded');

  const [offeringCount, topicCount, activityCount, submissionCount, traceCount] = await Promise.all([
    prisma.courseOffering.count(),
    prisma.topic.count(),
    prisma.activity.count(),
    prisma.submission.count(),
    prisma.aiInteractionTrace.count(),
  ]);

  console.log(
    `Seed complete — ${offeringCount} offerings, ${topicCount} topics, ` +
      `${activityCount} activities, ${submissionCount} submissions, ${traceCount} AI traces`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
