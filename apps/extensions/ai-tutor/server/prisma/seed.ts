import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

const prisma = new PrismaClient();

async function clearDatabase() {
  await prisma.suggestedPrompt.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.systemPrompt.deleteMany();

  await prisma.submission.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.module.deleteMany();
  await prisma.courseInstructor.deleteMany();
  await prisma.courseEnrollment.deleteMany();
  await prisma.courseOffering.deleteMany();
  await prisma.promptTemplate.deleteMany();
  await prisma.user.deleteMany();
}

async function createBaseSystemPrompt() {
  const helpfulBasePrompt = `You are a concise teaching assistant. Provide brief, actionable guidance in 2-3 sentences (under 50 words).

CRITICAL: Keep responses extremely short and focused. The student cannot reply, so give one clear hint or insight they can act on immediately.

Guidelines:
- Maximum 2-3 sentences, under 50 words total
- Give ONE specific hint or next step
- Use simple language and avoid lengthy explanations
- Never ask questions - give direct guidance
- Be encouraging but extremely brief`;

  return prisma.systemPrompt.create({
    data: {
      slug: 'global-activity-base',
      content: helpfulBasePrompt,
    },
  });
}

async function createSuggestedPrompts() {
  const prompts = [
    // Teach mode prompts
    { mode: 'teach', text: 'Can you explain this concept in simpler terms?', position: 1 },
    { mode: 'teach', text: 'What are the key things I should understand about this topic?', position: 2 },
    { mode: 'teach', text: 'Can you give me an example to help me understand?', position: 3 },
    { mode: 'teach', text: 'Why is this concept important?', position: 4 },
    // Guide mode prompts
    { mode: 'guide', text: 'I\'m stuck, can you give me a hint?', position: 1 },
    { mode: 'guide', text: 'What should I think about to solve this?', position: 2 },
    { mode: 'guide', text: 'Am I on the right track with my approach?', position: 3 },
    { mode: 'guide', text: 'What concept should I review to answer this?', position: 4 },
  ];

  await prisma.suggestedPrompt.createMany({
    data: prompts.map((p) => ({ ...p, isActive: true })),
  });
}



async function createUsers() {
  const [studentPw, student2Pw, instructorPw, assistantPw] = await Promise.all([
    hashPassword('student123'),
    hashPassword('student456'),
    hashPassword('instructor123'),
    hashPassword('assistant123'),
  ]);

  const [student, studentTwo, instructor, assistant] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Student One',
        email: 'student@example.com',
        password: studentPw,
        role: 'STUDENT',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Student Two',
        email: 'student2@example.com',
        password: student2Pw,
        role: 'STUDENT',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Lead Instructor',
        email: 'instructor@example.com',
        password: instructorPw,
        role: 'PROFESSOR',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Assistant Instructor',
        email: 'assistant@example.com',
        password: assistantPw,
        role: 'PROFESSOR',
      },
    }),
  ]);

  // Create Better Auth credential accounts for seeded users
  await Promise.all([
    prisma.account.create({
      data: {
        providerId: 'credential',
        accountId: String(student.id),
        userId: student.id,
        password: studentPw,
      },
    }),
    prisma.account.create({
      data: {
        providerId: 'credential',
        accountId: String(studentTwo.id),
        userId: studentTwo.id,
        password: student2Pw,
      },
    }),
    prisma.account.create({
      data: {
        providerId: 'credential',
        accountId: String(instructor.id),
        userId: instructor.id,
        password: instructorPw,
      },
    }),
    prisma.account.create({
      data: {
        providerId: 'credential',
        accountId: String(assistant.id),
        userId: assistant.id,
        password: assistantPw,
      },
    }),
  ]);

  return { student, studentTwo, instructor, assistant };
}

async function createPromptTemplates() {
  const knowledgePrompt = await prisma.promptTemplate.create({
    data: {
      name: 'Knowledge Check Default',
      slug: 'knowledge-check',
      systemPrompt:
        'You are a helpful teaching assistant. Offer concise hints when the student struggles.',
      temperature: 0.2,
      topP: 0.9,
    },
  });

  const debuggingPrompt = await prisma.promptTemplate.create({
    data: {
      name: 'Debugging Assistant',
      slug: 'debugging',
      systemPrompt:
        'You are an AI programming TA. Help students reason about bugs without writing the full fix.',
      temperature: 0.4,
      topP: 0.9,
    },
  });

  const learningPrompt = await prisma.promptTemplate.create({
    data: {
      name: 'Learning Prompt',
      slug: 'learning-prompt',
      systemPrompt: `You are a friendly tutor who is eager to help students learn by asking questions and providing examples. You are going to help students learn about [INSERT TOPIC HERE]. You will do this by asking what the students' knowledge level is (from beginner to advanced) and depending on the student's level of knowledge, you will either speed up your teaching style (for advanced students) or drastically slow down your teaching style (for beginner students). You will give examples and slowly introduce the topic to the student while asking them if they have any questions between each section. Only after any questions have been answered will you continue to teach. Assume you are speaking to a university student.

Give the students examples and explanations. If the student is struggling to understand something, don't give them the answer but instead give them different ways to think about the topic or introduce other examples. Another way to help a struggling student is to give them hints and words of encouragement. A good way to see if a student has understood your lesson is to have them repeat the current subject back to you in their own words. While teaching you should be asking them questions and having them answer to show their understanding. Make sure you cover each topic fully and confirm that the student has learned enough about the topic before moving on.`,
      temperature: 0.7,
      topP: 0.9,
    },
  });

  const exercisePrompt = await prisma.promptTemplate.create({
    data: {
      name: 'Exercise Prompt',
      slug: 'exercise-prompt',
      systemPrompt: `You are a friendly tutor who is eager to help students learn by asking questions and providing examples. A student is going to send you a code snippet, and you will help them solve it. You will do this by trying to give them advice and guidance but do not give them the answer straight away. You should never tell the student what is wrong with the code, instead teach them about the topic at hand and try to have them figure out the answer for themselves. You will give other examples about what is wrong with the snippet and slowly guide the student to the right answer. Assume you are speaking to a university level student.

The first thing you should do is ask the student for the code snippet. After receiving the block of code, ask them how knowledgeable they are with the topic that the code centers around. After finding out their knowledge level, try teaching them about what is wrong but do not just tell them immediately. A good way to have students learn is to teach them about the topic starting from the basics and see if they can discover the problem on their own. Remember, do not ever tell them what is wrong with the code OR how to fix it, only give hints.

[ENTER CODE HERE]

We are learning about [ENTER TOPIC], and I [ENTER KNOWLEDGE LEVEL].`,
      temperature: 0.7,
      topP: 0.9,
    },
  });

  const supervisorPrompt = await prisma.promptTemplate.create({
    data: {
      name: 'Supervisor Prompt',
      slug: 'supervisor-prompt',
      systemPrompt: `You are a pedagogical supervisor reviewing a tutor's response to a student.

RULES the tutor MUST follow:
1. NEVER directly reveal answers, solutions, or correct options
2. Guide via questions, hints, analogies — not direct statements
3. Never explicitly confirm "correct" or "incorrect"
4. Be encouraging but don't do the thinking for the student
5. If student asks for the answer directly, redirect them to think critically

Review the tutor's draft response and determine if it violates these rules.

Respond with ONLY valid JSON (no markdown, no extra text):
{"approved": true}
OR
{"approved": false, "reason": "brief explanation", "feedbackToTutor": "how to improve", "safeResponseToStudent": "a safe, student-facing fallback that does not reveal the answer"}`,
      temperature: 0.1,
      topP: 0.9,
    },
  });

  return {
    knowledgePrompt,
    debuggingPrompt,
    learningPrompt,
    exercisePrompt,
    supervisorPrompt,
  };
}

function knowledgeCheckConfig({ question, type, options, answer, hints }) {
  return {
    question,
    questionType: type ?? 'MCQ',
    options: options ?? null,
    answer: answer ?? null,
    hints: hints ?? [],
  };
}

function debuggingConfig({ question, context, answer, hints }) {
  return {
    question,
    debugContext: context,
    questionType: 'SHORT_TEXT',
    answer: answer ?? null,
    hints: hints ?? [],
  };
}

async function createCourseWithContent(course, modules, defaults, topics = []) {
  const offering = await prisma.courseOffering.create({
    data: {
      title: course.title,
      description: course.description ?? null,
      startDate: course.startDate ?? null,
      endDate: course.endDate ?? null,
      isPublished: Boolean(course.isPublished ?? false),
    },
  });

  const topicNameToId = new Map();

  const baseTopics = Array.isArray(topics) ? topics : [];
  for (const topicName of baseTopics) {
    const created = await prisma.topic.create({
      data: {
        name: topicName,
        courseOfferingId: offering.id,
      },
    });
    topicNameToId.set(topicName, created.id);
  }

  for (const [moduleIndex, module] of modules.entries()) {
    const createdModule = await prisma.module.create({
      data: {
        title: module.title,
        description: module.description ?? null,
        position: module.position ?? moduleIndex + 1,
        courseOfferingId: offering.id,
      },
    });

    for (const [lessonIndex, lesson] of (module.lessons ?? []).entries()) {
      const createdLesson = await prisma.lesson.create({
        data: {
          title: lesson.title,
          contentMd: lesson.contentMd ?? '',
          position: lesson.position ?? lessonIndex + 1,
          moduleId: createdModule.id,
        },
      });

      for (const [activityIndex, activity] of (lesson.activities ?? []).entries()) {
        const mainTopicName = activity.mainTopic;
        if (!mainTopicName || typeof mainTopicName !== 'string') {
          throw new Error(`Seed activity "${activity.title}" is missing a mainTopic`);
        }

        let mainTopicId = topicNameToId.get(mainTopicName);
        if (!mainTopicId) {
          const createdTopic = await prisma.topic.create({
            data: {
              name: mainTopicName,
              courseOfferingId: offering.id,
            },
          });
          topicNameToId.set(mainTopicName, createdTopic.id);
          mainTopicId = createdTopic.id;
        }

        const secondaryNames = Array.isArray(activity.secondaryTopics)
          ? activity.secondaryTopics
          : [];

        const secondaryTopicIds = [];
        for (const name of secondaryNames) {
          if (typeof name !== 'string' || name === mainTopicName) continue;
          let topicId = topicNameToId.get(name);
          if (!topicId) {
            const createdTopic = await prisma.topic.create({
              data: {
                name,
                courseOfferingId: offering.id,
              },
            });
            topicNameToId.set(name, createdTopic.id);
            topicId = createdTopic.id;
          }
          secondaryTopicIds.push(topicId);
        }

        await prisma.activity.create({
          data: {
            title: activity.title ?? null,
            instructionsMd: activity.instructionsMd ?? 'Answer the question.',
            position: activity.position ?? activityIndex + 1,
            lessonId: createdLesson.id,
            promptTemplateId: Object.prototype.hasOwnProperty.call(activity, 'promptTemplateId')
              ? activity.promptTemplateId ?? null
              : defaults.knowledgePrompt.id,
            config: activity.config,
            mainTopicId,
            secondaryTopics:
              secondaryTopicIds.length > 0
                ? {
                    create: secondaryTopicIds.map((topicId) => ({
                      topic: { connect: { id: topicId } },
                    })),
                  }
                : undefined,
          },
        });
      }
    }
  }

  return offering;
}

async function ensureTopicForCourse(courseOfferingId, name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Topic name must be provided');

  const existing = await prisma.topic.findUnique({
    where: {
      courseOfferingId_name: {
        courseOfferingId,
        name: trimmed,
      },
    },
  });

  if (existing) return existing.id;

  const created = await prisma.topic.create({
    data: {
      name: trimmed,
      courseOfferingId,
    },
  });

  return created.id;
}

async function copyLessonsBetweenOfferings(lessonIds, targetModuleId) {
  const targetModule = await prisma.module.findUnique({
    where: { id: targetModuleId },
    select: { courseOfferingId: true },
  });
  if (!targetModule) return;

  const lessons = await prisma.lesson.findMany({
    where: { id: { in: lessonIds } },
    include: {
      module: { select: { courseOfferingId: true } },
      activities: {
        orderBy: { position: 'asc' },
        include: { secondaryTopics: true },
      },
    },
    orderBy: { position: 'asc' },
  });

  if (lessons.length === 0) return;

  const sourceTopicById = new Map();
  const sourceCourseIds = new Set(
    lessons.map((lesson) => lesson.module.courseOfferingId).filter((value) => Number.isInteger(value)),
  );

  for (const courseId of sourceCourseIds) {
    const topics = await prisma.topic.findMany({ where: { courseOfferingId: courseId } });
    for (const topic of topics) {
      sourceTopicById.set(topic.id, topic);
    }
  }

  const existingTargetTopics = await prisma.topic.findMany({
    where: { courseOfferingId: targetModule.courseOfferingId },
  });
  const targetTopicsByName = new Map(existingTargetTopics.map((topic) => [topic.name, topic]));
  const topicIdMap = new Map();

  const resolveTopicId = async (sourceTopicId) => {
    if (!sourceTopicId) return null;
    if (topicIdMap.has(sourceTopicId)) {
      return topicIdMap.get(sourceTopicId);
    }
    const sourceTopic = sourceTopicById.get(sourceTopicId);
    if (!sourceTopic) return null;

    let targetTopic = targetTopicsByName.get(sourceTopic.name);
    if (!targetTopic) {
      targetTopic = await prisma.topic.create({
        data: {
          name: sourceTopic.name,
          courseOfferingId: targetModule.courseOfferingId,
        },
      });
      targetTopicsByName.set(sourceTopic.name, targetTopic);
    }

    topicIdMap.set(sourceTopicId, targetTopic.id);
    return targetTopic.id;
  };

  const maxPosition = await prisma.lesson.aggregate({
    where: { moduleId: targetModuleId },
    _max: { position: true },
  });
  let nextLessonPosition = maxPosition._max.position ?? 0;

  for (const lesson of lessons) {
    nextLessonPosition += 1;
    const createdLesson = await prisma.lesson.create({
      data: {
        title: `${lesson.title} (Imported)`,
        contentMd: lesson.contentMd,
        position: nextLessonPosition,
        moduleId: targetModuleId,
      },
    });

    for (const activity of lesson.activities) {
      const mainTopicId = await resolveTopicId(activity.mainTopicId);
      if (!mainTopicId) {
        throw new Error('Failed to map main topic while copying seed lessons.');
      }

      const secondaryTopics = [];
      for (const relation of activity.secondaryTopics) {
        const mapped = await resolveTopicId(relation.topicId);
        if (mapped) {
          secondaryTopics.push(mapped);
        }
      }

      await prisma.activity.create({
        data: {
          title: activity.title,
          instructionsMd: activity.instructionsMd,
          position: activity.position,
          lesson: { connect: { id: createdLesson.id } },
          promptTemplate: activity.promptTemplateId ? { connect: { id: activity.promptTemplateId } } : undefined,
          config: activity.config,
          mainTopic: { connect: { id: mainTopicId } },
          secondaryTopics:
            secondaryTopics.length > 0
              ? {
                  create: secondaryTopics.map((topicId) => ({ topic: { connect: { id: topicId } } })),
                }
              : undefined,
        },
      });
    }
  }
}

async function createSampleSubmissions(algorithmsOfferingId, linearOfferingId, studentIds) {
  const [studentOneId, studentTwoId] = studentIds;

  const sortingActivity = await prisma.activity.findFirst({
    where: {
      lesson: {
        module: {
          courseOfferingId: algorithmsOfferingId,
          title: 'Sorting',
        },
        title: 'Sorting Fundamentals',
      },
      config: {
        path: ['questionType'],
        equals: 'MCQ',
      },
    },
  });

  const vectorActivity = await prisma.activity.findFirst({
    where: {
      lesson: {
        module: {
          courseOfferingId: linearOfferingId,
          title: 'Vectors',
        },
        title: 'Vectors 101',
      },
    },
  });

  const debuggingActivity = await prisma.activity.findFirst({
    where: {
      lesson: {
        module: {
          courseOfferingId: algorithmsOfferingId,
          title: 'Capstone Sprint',
        },
      },
    },
  });

  if (sortingActivity) {
    await prisma.submission.createMany({
      data: [
        {
          userId: studentOneId,
          activityId: sortingActivity.id,
          attemptNumber: 1,
          response: { answerOption: 2 },
          aiFeedback: { message: 'Great work! Partitioning was the clue.' },
          isCorrect: true,
        },
        {
          userId: studentTwoId,
          activityId: sortingActivity.id,
          attemptNumber: 1,
          response: { answerOption: 1 },
          aiFeedback: { message: 'Not quite. Remember which algorithm picks a pivot.' },
          isCorrect: false,
        },
      ],
    });
  }

  if (vectorActivity) {
    await prisma.submission.create({
      data: {
        userId: studentOneId,
        activityId: vectorActivity.id,
        attemptNumber: 1,
        response: { answerText: '11' },
        aiFeedback: { message: 'Correct, multiply and add component-wise.' },
        isCorrect: true,
      },
    });
  }

  if (debuggingActivity) {
    await prisma.submission.create({
      data: {
        userId: studentTwoId,
        activityId: debuggingActivity.id,
        attemptNumber: 1,
        response: { answerText: 'Add a visited set.' },
        aiFeedback: { message: 'Yes! Tracking visited nodes prevents cycles.' },
        isCorrect: true,
      },
    });
  }
}

async function main() {
  console.log('Resetting and seeding database with course-based samples...');
  await clearDatabase();

  await createBaseSystemPrompt();
  await createSuggestedPrompts();

  const { student, studentTwo, instructor, assistant } = await createUsers();
  const foundation = await createPromptTemplates();

  const algorithmsCourse = await createCourseWithContent(
    {
      title: 'Intro to Algorithms - Fall Cohort',
      description: 'Primary offering cloned by instructors for new cohorts.',
      isPublished: true,
      startDate: new Date('2025-09-01'),
      endDate: new Date('2025-12-15'),
    },
    [
      {
        title: 'Sorting',
        description: 'Ordering items efficiently.',
        lessons: [
          {
            title: 'Sorting Fundamentals',
            contentMd: 'Review the core properties of popular sorting algorithms.',
            activities: [
              {
                title: 'Average complexity checkpoint',
                promptTemplateId: foundation.knowledgePrompt.id,
                mainTopic: 'Sorting Fundamentals',
                secondaryTopics: ['Algorithm Complexity'],
                config: knowledgeCheckConfig({
                  question: 'Which sorting algorithm has average O(n log n) time and uses partitioning?',
                  type: 'MCQ',
                  options: ['Insertion Sort', 'Merge Sort', 'Quick Sort', 'Bubble Sort'],
                  answer: { correctIndex: 2 },
                  hints: [
                    'It selects a pivot and partitions the array around it.',
                    'Average case is O(n log n); worst case degrades without optimizations.',
                  ],
                }),
              },
              {
                title: 'Stability check',
                promptTemplateId: foundation.knowledgePrompt.id,
                mainTopic: 'Sorting Stability',
                config: knowledgeCheckConfig({
                  question: 'Stable sorting: which of these is stable by default?',
                  type: 'MCQ',
                  options: ['Quick Sort', 'Heap Sort', 'Merge Sort', 'Selection Sort'],
                  answer: { correctIndex: 2 },
                  hints: ['Think divide-and-conquer algorithms that merge sorted halves.'],
                }),
              },
            ],
          },
        ],
      },
      {
        title: 'Graph Basics',
        description: 'Traversal and representation techniques.',
        lessons: [
          {
            title: 'Depth-First Search Review',
            contentMd: 'Understand how DFS explores nodes.',
            activities: [
              {
                title: 'Traversal structure',
                promptTemplateId: foundation.knowledgePrompt.id,
                mainTopic: 'Graph Traversal',
                config: knowledgeCheckConfig({
                  question: 'DFS uses which data structure for traversal?',
                  type: 'MCQ',
                  options: ['Queue', 'Stack', 'Priority Queue', 'Hash Set'],
                  answer: { correctIndex: 1 },
                  hints: ['Consider LIFO behaviour.'],
                }),
              },
            ],
          },
          {
            title: 'Debugging DFS',
            contentMd: 'Investigate a faulty DFS implementation.',
            activities: [
              {
                title: 'Fix the recursion bug',
                promptTemplateId: foundation.debuggingPrompt.id,
                mainTopic: 'Graph Debugging',
                secondaryTopics: ['Graph Traversal'],
                config: debuggingConfig({
                  question: 'The DFS function revisits nodes endlessly. What is missing?',
                  context:
                    'function dfs(node) {\n  for (const neighbor of graph[node]) {\n    dfs(neighbor);\n  }\n}\nconsole.log(dfs(0));',
                  answer: { text: 'Mark nodes as visited before recursing.' },
                  hints: [
                    'Think about preventing infinite recursion.',
                    'DFS usually keeps a visited set.',
                  ],
                }),
              },
            ],
          },
        ],
      },
      {
        title: 'Dynamic Programming Basics',
        description: 'Breaking problems into overlapping subproblems.',
        lessons: [
          {
            title: 'Memoization Concepts',
            contentMd: 'Introduce memoization and tabulation strategies.',
            activities: [
              {
                title: 'Identify the overlapping subproblem',
                promptTemplateId: foundation.knowledgePrompt.id,
                mainTopic: 'Dynamic Programming',
                secondaryTopics: ['Memoization Strategies'],
                config: knowledgeCheckConfig({
                  question: 'In the Fibonacci sequence, what subproblem repeats and benefits from memoization?',
                  type: 'SHORT_TEXT',
                  answer: { text: 'Computing smaller Fibonacci numbers like F(n-1) and F(n-2).' },
                  hints: ['Look at recursive calls inside fib(n).'],
                }),
              },
            ],
          },
        ],
      },
    ],
    foundation,
    [
      'Sorting Fundamentals',
      'Sorting Stability',
      'Algorithm Complexity',
      'Graph Traversal',
      'Graph Debugging',
      'Dynamic Programming',
      'Memoization Strategies',
    ],
  );

  const linearCourse = await createCourseWithContent(
    {
      title: 'Linear Algebra - Evening Cohort',
      description: 'Vectors, matrices, and linear transformations.',
      isPublished: true,
      startDate: new Date('2025-09-05'),
      endDate: new Date('2025-12-10'),
    },
    [
      {
        title: 'Vectors',
        description: 'Basics of vector spaces.',
        lessons: [
          {
            title: 'Vectors 101',
            contentMd: 'Build intuition around dot products.',
            activities: [
              {
                title: 'Dot product warm-up',
                promptTemplateId: foundation.knowledgePrompt.id,
                mainTopic: 'Dot Product',
                secondaryTopics: ['Vector Fundamentals'],
                config: knowledgeCheckConfig({
                  question: 'What is the dot product of (1,2) and (3,4)? Provide a number.',
                  type: 'SHORT_TEXT',
                  answer: { text: '11' },
                  hints: ['Multiply corresponding entries and add them.'],
                }),
              },
            ],
          },
        ],
      },
      {
        title: 'Matrices',
        description: 'Matrix operations and properties.',
        lessons: [
          {
            title: 'Matrix Multiplication Rules',
            contentMd: 'Understand when AB is defined.',
            activities: [
              {
                title: 'Shape compatibility',
                promptTemplateId: foundation.knowledgePrompt.id,
                mainTopic: 'Matrix Multiplication',
                secondaryTopics: ['Matrix Basics'],
                config: knowledgeCheckConfig({
                  question: 'Can a 2x3 matrix multiply a 3x4 matrix? Answer yes or no.',
                  type: 'SHORT_TEXT',
                  answer: { text: 'yes' },
                  hints: ['Match the inner dimensions.'],
                }),
              },
            ],
          },
        ],
      },
    ],
    foundation,
    ['Vector Fundamentals', 'Dot Product', 'Matrix Basics', 'Matrix Multiplication'],
  );

  const physicsCourse = await createCourseWithContent(
    {
      title: 'Physics I - Seminar',
      description: 'Kinematics and Newtonian mechanics.',
      isPublished: true,
    },
    [
      {
        title: 'Kinematics',
        description: 'Motion without forces.',
        lessons: [
          {
            title: 'Displacement vs. Time',
            contentMd: 'Interpret slope as velocity.',
            activities: [
              {
                title: 'Graph interpretation',
                promptTemplateId: foundation.knowledgePrompt.id,
                mainTopic: 'Velocity',
                secondaryTopics: ['Graph Interpretation'],
                config: knowledgeCheckConfig({
                  question:
                    'A displacement-time graph has a constant positive slope. What can you say about velocity?',
                  type: 'SHORT_TEXT',
                  answer: { text: 'Velocity is constant and positive.' },
                  hints: ['Slope of displacement-time equals velocity.'],
                }),
              },
            ],
          },
        ],
      },
    ],
    foundation,
    ['Kinematics', 'Velocity', 'Graph Interpretation'],
  );

  await prisma.courseInstructor.createMany({
    data: [
      { courseOfferingId: algorithmsCourse.id, userId: instructor.id, role: 'LEAD' },
      { courseOfferingId: algorithmsCourse.id, userId: assistant.id, role: 'ASSISTANT' },
      { courseOfferingId: linearCourse.id, userId: instructor.id, role: 'LEAD' },
      { courseOfferingId: physicsCourse.id, userId: assistant.id, role: 'LEAD' },
    ],
  });

  await prisma.courseEnrollment.createMany({
    data: [
      { courseOfferingId: algorithmsCourse.id, userId: student.id },
      { courseOfferingId: algorithmsCourse.id, userId: studentTwo.id },
      { courseOfferingId: linearCourse.id, userId: student.id },
      { courseOfferingId: physicsCourse.id, userId: studentTwo.id },
    ],
  });

  const capstoneModule = await prisma.module.create({
    data: {
      title: 'Capstone Sprint',
      description: 'Custom module demonstrating instructor-authored content.',
      position: 4,
      courseOfferingId: algorithmsCourse.id,
    },
  });

  const capstoneLesson = await prisma.lesson.create({
    data: {
      title: 'Code Review Warm-up',
      contentMd: 'Review the provided DFS implementation and describe the bug.',
      position: 1,
      moduleId: capstoneModule.id,
    },
  });

  await prisma.activity.create({
    data: {
      title: 'DFS bug hunt',
      instructionsMd: 'Explain the fix for the provided DFS implementation.',
      position: 1,
      lesson: { connect: { id: capstoneLesson.id } },
      promptTemplate: { connect: { id: foundation.debuggingPrompt.id } },
      mainTopic: { connect: { id: await ensureTopicForCourse(algorithmsCourse.id, 'Graph Debugging') } },
      config: debuggingConfig({
        question: 'The DFS still revisits nodes after marking them visited inside recursion. What is wrong?',
        context:
          'function dfs(node) {\n  visited.add(node);\n  for (const neighbor of graph[node]) {\n    if (!visited.has(neighbor)) {\n      dfs(node); // BUG\n    }\n  }\n}\n',
        answer: { text: 'Should recurse on neighbor, not node.' },
        hints: ['Check the recursive call argument.', 'Compare with pseudo-code for DFS.'],
      }),
      secondaryTopics: {
        create: [
          {
            topic: {
              connect: {
                id: await ensureTopicForCourse(algorithmsCourse.id, 'Graph Traversal'),
              },
            },
          },
        ],
      },
    },
  });

  const physicsStudioModule = await prisma.module.create({
    data: {
      title: 'Applied Practice',
      description: 'Imported lessons for additional practice.',
      position: 2,
      courseOfferingId: physicsCourse.id,
    },
  });

  const sortingLessons = await prisma.lesson.findMany({
    where: {
      module: {
        courseOfferingId: algorithmsCourse.id,
        title: 'Sorting',
      },
    },
    orderBy: { position: 'asc' },
  });

  if (sortingLessons.length > 0) {
    await copyLessonsBetweenOfferings([sortingLessons[0].id], physicsStudioModule.id);
  }

  await createSampleSubmissions(algorithmsCourse.id, linearCourse.id, [student.id, studentTwo.id]);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
