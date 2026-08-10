/**
 * @file Integration tests for the move-to-position endpoints (#1207).
 *
 * These cover the property that matters for a paged list: after ANY move, the
 * sibling positions must still be a contiguous `0..n-1` with no duplicates and
 * the requested row at the requested ordinal. A drag on page 3 sends an ordinal
 * the client can't verify locally, so a half-applied shift would silently
 * corrupt an order nobody is looking at.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  makeProfessor,
  makeAdmin,
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

describe('Move-to-position reordering (#1207)', () => {
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

  /** Create `count` extra modules after the seeded one, at positions 1..count. */
  async function seedModules(count) {
    const created = [];
    for (let i = 1; i <= count; i += 1) {
      created.push(
        // eslint-disable-next-line no-await-in-loop
        await prisma.module.create({
          data: {
            title: `Module ${i}`,
            position: i,
            isPublished: true,
            courseOfferingId: seed.course.id,
          },
        }),
      );
    }
    return [seed.module, ...created];
  }

  /** Ordered module ids for the seeded course, as the list endpoint would return them. */
  async function moduleOrder() {
    const rows = await prisma.module.findMany({
      where: { courseOfferingId: seed.course.id },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true },
    });
    return rows;
  }

  /** The invariant every move must preserve. */
  function expectContiguous(rows) {
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i));
  }

  describe('PATCH /modules/:moduleId/position', () => {
    it('moves a module down and leaves positions contiguous', async () => {
      const modules = await seedModules(4); // ordinals 0..4

      const res = await request(profApp)
        .patch(`/api/modules/${modules[1].id}/position`)
        .send({ position: 3 });

      expect(res.status).toBe(200);
      expect(res.body.position).toBe(3);
      expect(res.body.total).toBe(5);

      const rows = await moduleOrder();
      expectContiguous(rows);
      expect(rows.map((r) => r.id)).toEqual([
        modules[0].id,
        modules[2].id,
        modules[3].id,
        modules[1].id,
        modules[4].id,
      ]);
    });

    it('moves a module up and leaves positions contiguous', async () => {
      const modules = await seedModules(4);

      const res = await request(profApp)
        .patch(`/api/modules/${modules[3].id}/position`)
        .send({ position: 1 });

      expect(res.status).toBe(200);
      const rows = await moduleOrder();
      expectContiguous(rows);
      expect(rows.map((r) => r.id)).toEqual([
        modules[0].id,
        modules[3].id,
        modules[1].id,
        modules[2].id,
        modules[4].id,
      ]);
    });

    it('moves a module to the front', async () => {
      const modules = await seedModules(3);

      await request(profApp)
        .patch(`/api/modules/${modules[3].id}/position`)
        .send({ position: 0 })
        .expect(200);

      const rows = await moduleOrder();
      expectContiguous(rows);
      expect(rows[0].id).toBe(modules[3].id);
    });

    it('clamps an out-of-range ordinal to the end instead of erroring', async () => {
      const modules = await seedModules(3); // 4 modules total

      const res = await request(profApp)
        .patch(`/api/modules/${modules[0].id}/position`)
        .send({ position: 9999 });

      expect(res.status).toBe(200);
      // Clamped to the last slot, and reported back so the client can trust it
      // over its own optimistic guess.
      expect(res.body.position).toBe(3);

      const rows = await moduleOrder();
      expectContiguous(rows);
      expect(rows[rows.length - 1].id).toBe(modules[0].id);
    });

    it('is a no-op when the module is already at the target ordinal', async () => {
      const modules = await seedModules(3);
      const before = await moduleOrder();

      await request(profApp)
        .patch(`/api/modules/${modules[2].id}/position`)
        .send({ position: 2 })
        .expect(200);

      expect(await moduleOrder()).toEqual(before);
    });

    it('normalizes a list whose positions have gaps', async () => {
      // Deleting rows leaves gaps; `position` is not a rank until something
      // rewrites it. The ordinal must still mean "index in the ordered list".
      const modules = await seedModules(3);
      await prisma.module.update({ where: { id: modules[1].id }, data: { position: 50 } });
      await prisma.module.update({ where: { id: modules[2].id }, data: { position: 90 } });
      await prisma.module.update({ where: { id: modules[3].id }, data: { position: 91 } });
      // Order is now [seeded(0), m1(50), m2(90), m3(91)].

      await request(profApp)
        .patch(`/api/modules/${modules[3].id}/position`)
        .send({ position: 0 })
        .expect(200);

      const rows = await moduleOrder();
      expectContiguous(rows);
      expect(rows.map((r) => r.id)).toEqual([
        modules[3].id,
        modules[0].id,
        modules[1].id,
        modules[2].id,
      ]);
    });

    it('rejects a non-integer position with 400 POSITION_INVALID', async () => {
      const res = await request(profApp)
        .patch(`/api/modules/${seed.module.id}/position`)
        .send({ position: 'first' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('POSITION_INVALID');
    });

    it('rejects a negative position', async () => {
      const res = await request(profApp)
        .patch(`/api/modules/${seed.module.id}/position`)
        .send({ position: -1 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('POSITION_INVALID');
    });

    it('404s for a module that does not exist', async () => {
      const res = await request(profApp)
        .patch('/api/modules/99999999/position')
        .send({ position: 0 });
      expect(res.status).toBe(404);
    });

    it('403s for an instructor who does not lead the course', async () => {
      const other = makeProfessor();
      const otherApp = await createApp({ mockUser: other });

      const res = await request(otherApp)
        .patch(`/api/modules/${seed.module.id}/position`)
        .send({ position: 0 });

      expect(res.status).toBe(403);
    });

    it('403s for a student', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seed.course.id, userId: student.id, role: 'STUDENT' },
      });
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp)
        .patch(`/api/modules/${seed.module.id}/position`)
        .send({ position: 0 });

      expect(res.status).toBe(403);
    });

    it('allows an ADMIN who is not an instructor on the course', async () => {
      const adminApp = await createApp({ mockUser: makeAdmin() });
      await request(adminApp)
        .patch(`/api/modules/${seed.module.id}/position`)
        .send({ position: 0 })
        .expect(200);
    });
  });

  describe('PATCH /lessons/:lessonId/position', () => {
    async function seedLessons(count) {
      const created = [];
      for (let i = 1; i <= count; i += 1) {
        created.push(
          // eslint-disable-next-line no-await-in-loop
          await prisma.lesson.create({
            data: {
              title: `Lesson ${i}`,
              contentMd: '',
              position: i,
              isPublished: true,
              moduleId: seed.module.id,
            },
          }),
        );
      }
      return [seed.lesson, ...created];
    }

    it('moves a lesson within its module and stays contiguous', async () => {
      const lessons = await seedLessons(3);

      const res = await request(profApp)
        .patch(`/api/lessons/${lessons[0].id}/position`)
        .send({ position: 2 });

      expect(res.status).toBe(200);
      expect(res.body.position).toBe(2);

      const rows = await prisma.lesson.findMany({
        where: { moduleId: seed.module.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      });
      expectContiguous(rows);
      expect(rows[2].id).toBe(lessons[0].id);
    });

    it('does not disturb lessons in a sibling module', async () => {
      const otherModule = await prisma.module.create({
        data: {
          title: 'Other',
          position: 1,
          isPublished: true,
          courseOfferingId: seed.course.id,
        },
      });
      const untouched = await prisma.lesson.create({
        data: {
          title: 'Untouched',
          contentMd: '',
          position: 7,
          isPublished: true,
          moduleId: otherModule.id,
        },
      });
      const lessons = await seedLessons(2);

      await request(profApp)
        .patch(`/api/lessons/${lessons[2].id}/position`)
        .send({ position: 0 })
        .expect(200);

      const after = await prisma.lesson.findUnique({ where: { id: untouched.id } });
      expect(after.position).toBe(7);
    });

    it('403s for an instructor on another course', async () => {
      const otherApp = await createApp({ mockUser: makeProfessor() });
      const res = await request(otherApp)
        .patch(`/api/lessons/${seed.lesson.id}/position`)
        .send({ position: 0 });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /activities/:activityId/position', () => {
    async function seedActivities(count) {
      const created = [];
      for (let i = 0; i < count; i += 1) {
        created.push(
          // eslint-disable-next-line no-await-in-loop
          await prisma.activity.create({
            data: {
              title: `Activity ${i}`,
              instructionsMd: 'Answer it.',
              config: { question: `Q${i}`, questionType: 'SHORT_TEXT', hints: [] },
              position: i,
              lessonId: seed.lesson.id,
              mainTopicId: seed.topic.id,
            },
          }),
        );
      }
      return created;
    }

    it('moves an activity within its lesson and stays contiguous', async () => {
      const activities = await seedActivities(5);

      const res = await request(profApp)
        .patch(`/api/activities/${activities[4].id}/position`)
        .send({ position: 1 });

      expect(res.status).toBe(200);
      expect(res.body.position).toBe(1);
      expect(res.body.total).toBe(5);

      const rows = await prisma.activity.findMany({
        where: { lessonId: seed.lesson.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      });
      expectContiguous(rows);
      expect(rows.map((r) => r.id)).toEqual([
        activities[0].id,
        activities[4].id,
        activities[1].id,
        activities[2].id,
        activities[3].id,
      ]);
    });

    it('supports a cross-page ordinal (row on page 1 to the last slot)', async () => {
      // Page size 25: this is the move a numbered pager cannot express by drag.
      const activities = await seedActivities(30);

      const res = await request(profApp)
        .patch(`/api/activities/${activities[0].id}/position`)
        .send({ position: 29 });

      expect(res.status).toBe(200);
      expect(res.body.position).toBe(29);

      const rows = await prisma.activity.findMany({
        where: { lessonId: seed.lesson.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      });
      expectContiguous(rows);
      expect(rows[29].id).toBe(activities[0].id);
    });

    it('403s for an instructor on another course', async () => {
      const [activity] = await seedActivities(1);
      const otherApp = await createApp({ mockUser: makeProfessor() });
      const res = await request(otherApp)
        .patch(`/api/activities/${activity.id}/position`)
        .send({ position: 0 });
      expect(res.status).toBe(403);
    });
  });

  describe('bulk PUT .../order still guards against a partial list', () => {
    // The client-side truncation flag is gone; this is the server-side backstop
    // that keeps a caller holding one page from reassigning 0..n-1 over the
    // whole course and orphaning everything it never loaded.
    it('rejects an orderedIds that omits some of the course modules', async () => {
      const modules = await seedModules(3);

      const res = await request(profApp)
        .put(`/api/courses/${seed.course.id}/modules/order`)
        .send({ orderedIds: [modules[1].id, modules[0].id] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/full set/i);
    });

    it('403s an instructor who does not lead the course', async () => {
      // Regression guard: `isUnitAdminForCourse` is async and was previously
      // called without `await`, so this check passed a truthy Promise and let
      // any INSTRUCTOR reorder any course's tree.
      const modules = await seedModules(1);
      const otherApp = await createApp({ mockUser: makeProfessor() });

      const res = await request(otherApp)
        .put(`/api/courses/${seed.course.id}/modules/order`)
        .send({ orderedIds: [modules[1].id, modules[0].id] });

      expect(res.status).toBe(403);
    });
  });
});
