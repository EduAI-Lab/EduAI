import { prisma } from '../src/config/database.js';

// ----- Mock user factories -----

let counter = 0;
function nextId() {
  counter += 1;
  return `test_user_${counter}_${Date.now()}`;
}

export function makeProfessor(overrides = {}) {
  return {
    id: nextId(),
    name: 'Prof Test',
    email: `prof_${counter}@test.com`,
    role: 'INSTRUCTOR',
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerified: false,
    image: null,
    password: null,
    ...overrides,
  };
}

export function makeStudent(overrides = {}) {
  return {
    id: nextId(),
    name: 'Student Test',
    email: `student_${counter}@test.com`,
    role: 'STUDENT',
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerified: false,
    image: null,
    password: null,
    ...overrides,
  };
}

export function makeAdmin(overrides = {}) {
  return {
    id: nextId(),
    name: 'Admin Test',
    email: `admin_${counter}@test.com`,
    role: 'ADMIN',
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerified: false,
    image: null,
    password: null,
    ...overrides,
  };
}

// ----- Database utilities -----

export async function truncateAll() {
  // Use Prisma deleteMany in FK-safe order (children before parents).
  await prisma.aiInteractionTrace.deleteMany();
  await prisma.aiChatSession.deleteMany();
  await prisma.activityFeedback.deleteMany();
  await prisma.activityStudentMetric.deleteMany();
  await prisma.activityAnalytics.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.activitySecondaryTopic.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.module.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.courseInstructor.deleteMany();
  await prisma.courseEnrollment.deleteMany();
  await prisma.courseOffering.deleteMany();
  await prisma.suggestedPrompt.deleteMany();
  await prisma.systemPrompt.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.promptTemplate.deleteMany();
}

/**
 * Seed a minimal course structure: course -> module -> lesson -> topic.
 * If professorId is provided, a CourseInstructor record is created for them.
 */
export async function seedMinimalCourse(professorId) {
  const course = await prisma.courseOffering.create({
    data: {
      title: 'Test Course',
      description: 'A test course',
      isPublished: true,
    },
  });

  if (professorId) {
    await prisma.courseInstructor.create({
      data: { courseOfferingId: course.id, userId: professorId, role: 'LEAD' },
    });
  }

  const module = await prisma.module.create({
    data: {
      title: 'Test Module',
      description: 'A test module',
      position: 0,
      isPublished: true,
      courseOfferingId: course.id,
    },
  });

  const lesson = await prisma.lesson.create({
    data: {
      title: 'Test Lesson',
      contentMd: 'Test content',
      position: 0,
      isPublished: true,
      moduleId: module.id,
    },
  });

  const topic = await prisma.topic.create({
    data: {
      name: 'Test Topic',
      courseOfferingId: course.id,
    },
  });

  return { course, module, lesson, topic };
}

export { prisma };
