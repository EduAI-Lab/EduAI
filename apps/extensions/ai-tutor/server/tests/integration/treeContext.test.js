/**
 * @file Integration tests for the tree context endpoints (#1207).
 *
 * `GET /lessons/:id/context` and `GET /modules/:id/context` exist because the
 * clients used to derive these ordinals with `findIndex` over a full sibling
 * list — a read that silently returned -1 (rendering as "0") for anything past
 * the first page once those lists were paged. These tests pin the ordinals,
 * the prev/next links, and the rule that a student's ordinals count only the
 * siblings they can actually see.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  makeProfessor,
  makeStudent,
  truncateAll,
  seedMinimalCourse,
  prisma,
} from '../helpers.js';

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchCoreCourseSafe: vi.fn() };
});

import { fetchCoreCourseSafe } from '../../src/services/eduaiClient.js';

describe('Tree context endpoints (#1207)', () => {
  let prof;
  let seed;
  let profApp;

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();
    seed = await seedMinimalCourse(prof.id);
    profApp = await createApp({ mockUser: prof });
    vi.mocked(fetchCoreCourseSafe).mockImplementation(async (coreOfferingId) => ({
      id: coreOfferingId,
      isPublished: true,
    }));
  });

  async function addModule(position, { isPublished = true, title = `M${position}` } = {}) {
    return prisma.module.create({
      data: { title, position, isPublished, courseOfferingId: seed.course.id },
    });
  }

  async function addLesson(moduleId, position, { isPublished = true } = {}) {
    return prisma.lesson.create({
      data: { title: `L${position}`, contentMd: '', position, isPublished, moduleId },
    });
  }

  async function enrollStudent() {
    const student = makeStudent();
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: student.id, role: 'STUDENT' },
    });
    return student;
  }

  describe('GET /lessons/:lessonId/context', () => {
    it('returns 1-based ordinals for a middle lesson in a middle module', async () => {
      const module2 = await addModule(1);
      await addModule(2);
      const l0 = await addLesson(module2.id, 0);
      const l1 = await addLesson(module2.id, 1);
      const l2 = await addLesson(module2.id, 2);

      const res = await request(profApp).get(`/api/lessons/${l1.id}/context`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        moduleOrdinal: 2,
        lessonOrdinal: 2,
        moduleTotal: 3,
        lessonTotal: 3,
        prevLessonId: l0.id,
        nextLessonId: l2.id,
      });
    });

    it('reports no prev for the first lesson and no next for the last', async () => {
      const l1 = await addLesson(seed.module.id, 1);

      const first = await request(profApp).get(`/api/lessons/${seed.lesson.id}/context`);
      expect(first.body.lessonOrdinal).toBe(1);
      expect(first.body.prevLessonId).toBeNull();
      expect(first.body.nextLessonId).toBe(l1.id);

      const last = await request(profApp).get(`/api/lessons/${l1.id}/context`);
      expect(last.body.lessonOrdinal).toBe(2);
      expect(last.body.prevLessonId).toBe(seed.lesson.id);
      expect(last.body.nextLessonId).toBeNull();
    });

    it('is correct past the tree page size, which is what #1207 fixes', async () => {
      // The client page size is 25; a findIndex over one page scored -1 here.
      for (let i = 1; i <= 30; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await addLesson(seed.module.id, i);
      }
      const target = await prisma.lesson.findFirst({
        where: { moduleId: seed.module.id, position: 28 },
      });

      const res = await request(profApp).get(`/api/lessons/${target.id}/context`);

      expect(res.status).toBe(200);
      expect(res.body.lessonOrdinal).toBe(29);
      expect(res.body.lessonTotal).toBe(31);
    });

    it('breaks position ties by id, matching the list endpoint ordering', async () => {
      // `position` has no unique constraint, so duplicates are possible.
      const a = await addLesson(seed.module.id, 5);
      const b = await addLesson(seed.module.id, 5);

      const resA = await request(profApp).get(`/api/lessons/${a.id}/context`);
      const resB = await request(profApp).get(`/api/lessons/${b.id}/context`);

      expect(resA.body.lessonOrdinal).toBe(2);
      expect(resB.body.lessonOrdinal).toBe(3);
      expect(resA.body.nextLessonId).toBe(b.id);
      expect(resB.body.prevLessonId).toBe(a.id);
    });

    it('counts only published siblings for a student', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      // Unpublished lessons sit before the target; the instructor sees them,
      // the student must not — otherwise the ordinal disagrees with the tree
      // the student can actually navigate.
      await addLesson(seed.module.id, 1, { isPublished: false });
      await addLesson(seed.module.id, 2, { isPublished: false });
      const visible = await addLesson(seed.module.id, 3);

      const asStudent = await request(studentApp).get(`/api/lessons/${visible.id}/context`);
      expect(asStudent.status).toBe(200);
      expect(asStudent.body.lessonOrdinal).toBe(2);
      expect(asStudent.body.lessonTotal).toBe(2);
      expect(asStudent.body.prevLessonId).toBe(seed.lesson.id);

      const asProf = await request(profApp).get(`/api/lessons/${visible.id}/context`);
      expect(asProf.body.lessonOrdinal).toBe(4);
      expect(asProf.body.lessonTotal).toBe(4);
    });

    it('403s a student asking about an unpublished lesson', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      const hidden = await addLesson(seed.module.id, 1, { isPublished: false });

      const res = await request(studentApp).get(`/api/lessons/${hidden.id}/context`);
      expect(res.status).toBe(403);
    });

    it('403s a user with no relationship to the course', async () => {
      const outsiderApp = await createApp({ mockUser: makeStudent() });
      const res = await request(outsiderApp).get(`/api/lessons/${seed.lesson.id}/context`);
      expect(res.status).toBe(403);
    });

    it('404s for a lesson that does not exist', async () => {
      const res = await request(profApp).get('/api/lessons/99999999/context');
      expect(res.status).toBe(404);
    });

    it('400s for a non-numeric lesson id', async () => {
      const res = await request(profApp).get('/api/lessons/abc/context');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /modules/:moduleId/context', () => {
    it('returns the module ordinal and course total', async () => {
      await addModule(1);
      const module3 = await addModule(2);

      const res = await request(profApp).get(`/api/modules/${module3.id}/context`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ moduleOrdinal: 3, moduleTotal: 3 });
    });

    it('counts only published modules for a student', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      await addModule(1, { isPublished: false });
      const visible = await addModule(2);

      const res = await request(studentApp).get(`/api/modules/${visible.id}/context`);
      expect(res.body).toEqual({ moduleOrdinal: 2, moduleTotal: 2 });
    });

    it('403s a student asking about an unpublished module', async () => {
      const student = await enrollStudent();
      const studentApp = await createApp({ mockUser: student });
      const hidden = await addModule(1, { isPublished: false });

      const res = await request(studentApp).get(`/api/modules/${hidden.id}/context`);
      expect(res.status).toBe(403);
    });

    it('404s for a module that does not exist', async () => {
      const res = await request(profApp).get('/api/modules/99999999/context');
      expect(res.status).toBe(404);
    });
  });
});
