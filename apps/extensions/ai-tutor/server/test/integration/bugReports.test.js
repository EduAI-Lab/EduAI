import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeAdmin, makeProfessor, makeStudent, prisma, truncateAll } from '../helpers.js';

async function createCourseContext({ professorId, titlePrefix }) {
  const course = await prisma.courseOffering.create({
    data: {
      title: `${titlePrefix} Course`,
      isPublished: true,
    },
  });

  await prisma.courseInstructor.create({
    data: {
      courseOfferingId: course.id,
      userId: professorId,
      role: 'LEAD',
    },
  });

  const module = await prisma.module.create({
    data: {
      title: `${titlePrefix} Module`,
      position: 0,
      isPublished: true,
      courseOfferingId: course.id,
    },
  });

  const lesson = await prisma.lesson.create({
    data: {
      title: `${titlePrefix} Lesson`,
      position: 0,
      isPublished: true,
      moduleId: module.id,
    },
  });

  const topic = await prisma.topic.create({
    data: {
      name: `${titlePrefix} Topic`,
      courseOfferingId: course.id,
    },
  });

  const activity = await prisma.activity.create({
    data: {
      title: `${titlePrefix} Activity`,
      instructionsMd: 'Test instructions',
      lessonId: lesson.id,
      mainTopicId: topic.id,
    },
  });

  return { course, module, lesson, topic, activity };
}

describe('Bug report routes', () => {
  let student;
  let professor;
  let admin;
  let studentApp;
  let professorApp;
  let adminApp;
  let primaryContext;
  let secondaryContext;

  beforeEach(async () => {
    await truncateAll();

    student = makeStudent();
    professor = makeProfessor();
    admin = makeAdmin();

    await prisma.user.createMany({
      data: [
        {
          id: student.id,
          name: student.name,
          email: student.email,
          role: 'STUDENT',
        },
        {
          id: professor.id,
          name: professor.name,
          email: professor.email,
          role: 'PROFESSOR',
        },
        {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: 'ADMIN',
        },
      ],
    });

    primaryContext = await createCourseContext({
      professorId: professor.id,
      titlePrefix: 'Primary',
    });
    secondaryContext = await createCourseContext({
      professorId: professor.id,
      titlePrefix: 'Secondary',
    });

    await prisma.courseEnrollment.create({
      data: {
        courseOfferingId: primaryContext.course.id,
        userId: student.id,
      },
    });

    studentApp = await createApp({ mockUser: student });
    professorApp = await createApp({ mockUser: professor });
    adminApp = await createApp({ mockUser: admin });
  });

  it('student can submit a page-level bug report', async () => {
    const res = await request(studentApp).post('/api/bug-reports').send({
      description: 'The lesson page froze after I clicked submit twice.',
      pageUrl: 'http://localhost:5173/student',
      userAgent: 'Vitest',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('unhandled');
    expect(res.body.context).toEqual({
      courseOfferingId: null,
      moduleId: null,
      lessonId: null,
      activityId: null,
    });
  });

  it('professor can submit a page-level bug report', async () => {
    const res = await request(professorApp).post('/api/bug-reports').send({
      description: 'Builder toolbar disappeared while editing the question.',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('unhandled');
  });

  it('admin cannot submit to /api/bug-reports', async () => {
    const res = await request(adminApp).post('/api/bug-reports').send({
      description: 'Should not be allowed for admins.',
    });

    expect(res.status).toBe(403);
  });

  it('unauthenticated requests are rejected with 401', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/bug-reports').send({
      description: 'Unauthenticated submission should fail.',
    });

    expect(res.status).toBe(401);
  });

  it('rejects descriptions that are too short or too long', async () => {
    const shortRes = await request(studentApp).post('/api/bug-reports').send({
      description: 'Too short',
    });
    expect(shortRes.status).toBe(400);

    const longRes = await request(studentApp)
      .post('/api/bug-reports')
      .send({ description: 'x'.repeat(2001) });
    expect(longRes.status).toBe(400);
  });

  it('allows contextual report for valid enrolled student', async () => {
    const res = await request(studentApp).post('/api/bug-reports').send({
      description: 'Activity content loaded with stale answers.',
      context: {
        courseOfferingId: primaryContext.course.id,
        moduleId: primaryContext.module.id,
        lessonId: primaryContext.lesson.id,
        activityId: primaryContext.activity.id,
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.context).toEqual({
      courseOfferingId: primaryContext.course.id,
      moduleId: primaryContext.module.id,
      lessonId: primaryContext.lesson.id,
      activityId: primaryContext.activity.id,
    });
  });

  it('rejects contextual report when student lacks enrollment', async () => {
    const res = await request(studentApp).post('/api/bug-reports').send({
      description: 'I should not be able to report against this course context.',
      context: {
        courseOfferingId: secondaryContext.course.id,
        moduleId: secondaryContext.module.id,
        lessonId: secondaryContext.lesson.id,
        activityId: secondaryContext.activity.id,
      },
    });

    expect(res.status).toBe(403);
  });

  it('allows contextual report for valid professor assignment', async () => {
    const res = await request(professorApp).post('/api/bug-reports').send({
      description: 'Lesson editor did not save latest draft.',
      context: {
        courseOfferingId: primaryContext.course.id,
        moduleId: primaryContext.module.id,
        lessonId: primaryContext.lesson.id,
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.context.lessonId).toBe(primaryContext.lesson.id);
  });

  it('rejects contextual report when professor is not assigned to course', async () => {
    const otherProfessor = makeProfessor();
    await prisma.user.create({
      data: {
        id: otherProfessor.id,
        name: otherProfessor.name,
        email: otherProfessor.email,
        role: 'PROFESSOR',
      },
    });
    const otherProfessorApp = await createApp({ mockUser: otherProfessor });

    const res = await request(otherProfessorApp).post('/api/bug-reports').send({
      description: 'Unauthorized professor context report.',
      context: {
        courseOfferingId: primaryContext.course.id,
        moduleId: primaryContext.module.id,
      },
    });

    expect(res.status).toBe(403);
  });

  it('admin can list reports and non-admin cannot', async () => {
    await request(studentApp).post('/api/bug-reports').send({
      description: 'Admin listing should include this report.',
      context: {
        courseOfferingId: primaryContext.course.id,
        moduleId: primaryContext.module.id,
        lessonId: primaryContext.lesson.id,
        activityId: primaryContext.activity.id,
      },
      pageUrl: 'http://localhost:5173/student/lessons/1',
    });

    const adminRes = await request(adminApp).get('/api/admin/bug-reports');
    expect(adminRes.status).toBe(200);
    expect(Array.isArray(adminRes.body)).toBe(true);
    expect(adminRes.body.length).toBeGreaterThanOrEqual(1);
    expect(adminRes.body[0]).toEqual(
      expect.objectContaining({
        courseTitle: primaryContext.course.title,
        moduleTitle: primaryContext.module.title,
        lessonTitle: primaryContext.lesson.title,
        activityTitle: primaryContext.activity.title,
      }),
    );

    const studentRes = await request(studentApp).get('/api/admin/bug-reports');
    expect(studentRes.status).toBe(403);
  });

  it('admin can update report status and invalid status is rejected', async () => {
    const createRes = await request(studentApp).post('/api/bug-reports').send({
      description: 'Status workflow test report payload.',
    });
    const bugId = createRes.body.id;

    const patchRes = await request(adminApp).patch(`/api/admin/bug-reports/${bugId}`).send({
      status: 'in progress',
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('in progress');

    const invalidRes = await request(adminApp).patch(`/api/admin/bug-reports/${bugId}`).send({
      status: 'not-a-valid-status',
    });
    expect(invalidRes.status).toBe(400);
  });

  it('anonymous report keeps real userId but admin response masks identity', async () => {
    const createRes = await request(studentApp).post('/api/bug-reports').send({
      description: 'Anonymous report identity masking test.',
      isAnonymous: true,
    });
    expect(createRes.status).toBe(201);

    const row = await prisma.bugReport.findUnique({
      where: { id: createRes.body.id },
    });
    expect(row?.userId).toBe(student.id);
    expect(row?.isAnonymous).toBe(true);

    const listRes = await request(adminApp).get('/api/admin/bug-reports');
    expect(listRes.status).toBe(200);
    const created = listRes.body.find((item) => item.id === createRes.body.id);
    expect(created).toBeDefined();
    expect(created.userId).toBe(student.id);
    expect(created.reporterName).toBe('Anonymous');
    expect(created.reporterEmail).toBeNull();
    expect(created.user.email).toBeNull();
  });

  it('persists base64 screenshot and context IDs with round-trip admin data', async () => {
    const screenshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

    const createRes = await request(studentApp).post('/api/bug-reports').send({
      description: 'Screenshot persistence test with context.',
      screenshot,
      consoleLogs: '[{\"level\":\"error\",\"message\":\"boom\"}]',
      networkLogs: '[{\"url\":\"/api/test\",\"status\":500}]',
      context: {
        courseOfferingId: primaryContext.course.id,
        moduleId: primaryContext.module.id,
        lessonId: primaryContext.lesson.id,
      },
    });

    expect(createRes.status).toBe(201);

    const dbRow = await prisma.bugReport.findUnique({
      where: { id: createRes.body.id },
    });
    expect(dbRow?.screenshot).toBe(screenshot);
    expect(dbRow?.courseOfferingId).toBe(primaryContext.course.id);
    expect(dbRow?.moduleId).toBe(primaryContext.module.id);
    expect(dbRow?.lessonId).toBe(primaryContext.lesson.id);
    expect(dbRow?.activityId).toBeNull();

    const listRes = await request(adminApp).get('/api/admin/bug-reports');
    const adminRow = listRes.body.find((item) => item.id === createRes.body.id);
    expect(adminRow).toBeDefined();
    expect(adminRow.screenshot).toBe(screenshot);
    expect(adminRow.courseTitle).toBe(primaryContext.course.title);
    expect(adminRow.moduleTitle).toBe(primaryContext.module.title);
    expect(adminRow.lessonTitle).toBe(primaryContext.lesson.title);
    expect(adminRow.activityTitle).toBeNull();
  });
});
