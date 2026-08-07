/**
 * @file Integration tests for server-side `search` on the tree and importable
 * list endpoints (#1207).
 *
 * The two properties that matter:
 *   1. `total` reflects the FILTERED count, so a pager built on it pages the
 *      matches rather than the whole list;
 *   2. search is ANDed onto the visibility scope, so a student can never
 *      surface an unpublished row by searching for it.
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

describe('Tree endpoint search (#1207)', () => {
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

  async function enrollStudent() {
    const student = makeStudent();
    await prisma.courseEnrollment.create({
      data: { courseOfferingId: seed.course.id, userId: student.id, role: 'STUDENT' },
    });
    return createApp({ mockUser: student });
  }

  describe('GET /courses/:courseId/modules', () => {
    beforeEach(async () => {
      await prisma.module.create({
        data: {
          title: 'Graph Algorithms',
          description: 'Shortest paths',
          position: 1,
          isPublished: true,
          courseOfferingId: seed.course.id,
        },
      });
      await prisma.module.create({
        data: {
          title: 'Sorting',
          description: 'Includes a graph of runtimes',
          position: 2,
          isPublished: true,
          courseOfferingId: seed.course.id,
        },
      });
    });

    it('narrows both the rows and the total', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25, search: 'Graph Algorithms' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      // The filtered count — a pager reading this pages the matches, not the
      // whole course.
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].title).toBe('Graph Algorithms');
    });

    it('matches case-insensitively', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25, search: 'gRaPh aLgOrItHmS' });

      expect(res.body.total).toBe(1);
    });

    it('matches the description as well as the title', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25, search: 'runtimes' });

      expect(res.body.total).toBe(1);
      expect(res.body.data[0].title).toBe('Sorting');
    });

    it('returns an empty page with total 0 when nothing matches', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25, search: 'zzzz-no-such-module' });

      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('an absent search returns everything', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25 });

      expect(res.body.total).toBe(3);
    });

    it('a whitespace-only search is treated as no filter', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25, search: '   ' });

      expect(res.body.total).toBe(3);
    });

    it('paginates within the filtered set', async () => {
      for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await prisma.module.create({
          data: {
            title: `Graph part ${i}`,
            position: 10 + i,
            isPublished: true,
            courseOfferingId: seed.course.id,
          },
        });
      }

      const page1 = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 2, search: 'Graph' });
      const page2 = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 2, pageSize: 2, search: 'Graph' });

      // 5 "Graph part" + "Graph Algorithms" = 6 matches; "Sorting" matches on
      // its description too, so 7.
      expect(page1.body.total).toBe(7);
      expect(page1.body.data).toHaveLength(2);
      expect(page2.body.data).toHaveLength(2);
      const ids = new Set([...page1.body.data, ...page2.body.data].map((m) => m.id));
      expect(ids.size).toBe(4);
    });

    it('never surfaces an unpublished module to a student searching for it', async () => {
      const studentApp = await enrollStudent();
      await prisma.module.create({
        data: {
          title: 'Secret Graph Draft',
          position: 9,
          isPublished: false,
          courseOfferingId: seed.course.id,
        },
      });

      const res = await request(studentApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25, search: 'Secret Graph Draft' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);

      // The instructor does see it — proving the row exists and the student's
      // empty result comes from the visibility scope, not a typo.
      const asProf = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25, search: 'Secret Graph Draft' });
      expect(asProf.body.total).toBe(1);
    });

    it('400s SEARCH_INVALID on an over-long term', async () => {
      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/modules`)
        .query({ page: 1, pageSize: 25, search: 'a'.repeat(101) });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SEARCH_INVALID');
    });
  });

  describe('GET /modules/:moduleId/lessons', () => {
    it('narrows on the lesson title and respects student visibility', async () => {
      await prisma.lesson.create({
        data: {
          title: 'Dijkstra walkthrough',
          contentMd: '',
          position: 1,
          isPublished: true,
          moduleId: seed.module.id,
        },
      });
      await prisma.lesson.create({
        data: {
          title: 'Dijkstra draft',
          contentMd: '',
          position: 2,
          isPublished: false,
          moduleId: seed.module.id,
        },
      });

      const asProf = await request(profApp)
        .get(`/api/modules/${seed.module.id}/lessons`)
        .query({ page: 1, pageSize: 25, search: 'dijkstra' });
      expect(asProf.body.total).toBe(2);

      const studentApp = await enrollStudent();
      const asStudent = await request(studentApp)
        .get(`/api/modules/${seed.module.id}/lessons`)
        .query({ page: 1, pageSize: 25, search: 'dijkstra' });
      expect(asStudent.body.total).toBe(1);
      expect(asStudent.body.data[0].title).toBe('Dijkstra walkthrough');
    });
  });

  describe('GET /lessons/:lessonId/activities', () => {
    async function addActivity({ title, question, instructionsMd = 'Do it.' }) {
      return prisma.activity.create({
        data: {
          title,
          instructionsMd,
          config: { question, questionType: 'SHORT_TEXT', hints: [] },
          position: 0,
          lessonId: seed.lesson.id,
          mainTopicId: seed.topic.id,
        },
      });
    }

    it('matches the activity title', async () => {
      await addActivity({ title: 'Traversal drill', question: 'Walk the tree' });
      await addActivity({ title: 'Sorting drill', question: 'Order the list' });

      const res = await request(profApp)
        .get(`/api/lessons/${seed.lesson.id}/activities`)
        .query({ page: 1, pageSize: 25, search: 'traversal' });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    });

    it('matches the instructions', async () => {
      await addActivity({
        title: 'Untitled',
        question: 'Q',
        instructionsMd: 'Use breadth-first search.',
      });

      const res = await request(profApp)
        .get(`/api/lessons/${seed.lesson.id}/activities`)
        .query({ page: 1, pageSize: 25, search: 'breadth-first' });

      expect(res.body.total).toBe(1);
    });

    it('matches question text stored inside the config JSON', async () => {
      // There is no `question` column — it lives in `config`, so this needs a
      // JSON path filter rather than an ordinary contains.
      await addActivity({ title: 'A', question: 'What is a spanning tree?' });
      await addActivity({ title: 'B', question: 'Define a heap.' });

      const res = await request(profApp)
        .get(`/api/lessons/${seed.lesson.id}/activities`)
        .query({ page: 1, pageSize: 25, search: 'spanning tree' });

      expect(res.body.total).toBe(1);
      expect(res.body.data[0].title).toBe('A');
    });

    it('matches legacy question text stored under config.prompt', async () => {
      // `mapActivity` falls back to `config.prompt` when `config.question` is
      // absent, so rows written before the rename still DISPLAY a question.
      // Searching only `config.question` made that text unreachable.
      await prisma.activity.create({
        data: {
          title: 'Legacy',
          instructionsMd: 'Do it.',
          config: { prompt: 'Explain tail recursion', questionType: 'SHORT_TEXT', hints: [] },
          position: 0,
          lessonId: seed.lesson.id,
          mainTopicId: seed.topic.id,
        },
      });
      await addActivity({ title: 'Other', question: 'Define a heap.' });

      const res = await request(profApp)
        .get(`/api/lessons/${seed.lesson.id}/activities`)
        .query({ page: 1, pageSize: 25, search: 'tail recursion' });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].title).toBe('Legacy');
      // The row search found is the row the mapper renders a question for.
      expect(res.body.data[0].question).toBe('Explain tail recursion');
    });
  });

  describe('GET /courses/:courseId/topics', () => {
    it('narrows on the topic name', async () => {
      await prisma.topic.create({
        data: { name: 'Recursion', courseOfferingId: seed.course.id },
      });
      await prisma.topic.create({
        data: { name: 'Dynamic programming', courseOfferingId: seed.course.id },
      });

      const res = await request(profApp)
        .get(`/api/courses/${seed.course.id}/topics`)
        .query({ page: 1, pageSize: 25, search: 'recur' });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].name).toBe('Recursion');
    });
  });

  describe('GET /activities/importable', () => {
    let otherLesson;

    beforeEach(async () => {
      // A second lesson in the same course — importing between two lessons of
      // one course is valid, so these are legitimate candidates.
      otherLesson = await prisma.lesson.create({
        data: {
          title: 'Week 9 seminar',
          contentMd: '',
          position: 1,
          isPublished: true,
          moduleId: seed.module.id,
        },
      });
      await prisma.activity.create({
        data: {
          title: 'Heap insertion',
          instructionsMd: '',
          config: { question: 'Insert into a heap', questionType: 'SHORT_TEXT', hints: [] },
          position: 0,
          lessonId: otherLesson.id,
          mainTopicId: seed.topic.id,
        },
      });
      await prisma.activity.create({
        data: {
          title: 'Quicksort partition',
          instructionsMd: '',
          config: { question: 'Partition the array', questionType: 'SHORT_TEXT', hints: [] },
          position: 1,
          lessonId: otherLesson.id,
          mainTopicId: seed.topic.id,
        },
      });
    });

    it('narrows candidates by activity title', async () => {
      const res = await request(profApp).get('/api/activities/importable').query({
        courseId: seed.course.id,
        page: 1,
        pageSize: 25,
        search: 'heap',
      });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].title).toBe('Heap insertion');
    });

    it('matches the parent lesson title, which the picker rows display', async () => {
      const res = await request(profApp).get('/api/activities/importable').query({
        courseId: seed.course.id,
        page: 1,
        pageSize: 25,
        search: 'Week 9 seminar',
      });

      expect(res.body.total).toBe(2);
    });

    it('matches the parent module title', async () => {
      const res = await request(profApp).get('/api/activities/importable').query({
        courseId: seed.course.id,
        page: 1,
        pageSize: 25,
        search: 'Test Module',
      });

      expect(res.body.total).toBe(2);
    });

    it('still honours excludeLessonId alongside a search', async () => {
      const res = await request(profApp).get('/api/activities/importable').query({
        courseId: seed.course.id,
        excludeLessonId: otherLesson.id,
        page: 1,
        pageSize: 25,
        search: 'heap',
      });

      expect(res.body.total).toBe(0);
    });

    it('stays scoped to courses the caller manages', async () => {
      // Another instructor's course contains a matching activity; it must not
      // leak into this caller's candidate list even with a search term.
      const otherProf = makeProfessor();
      const otherSeed = await seedMinimalCourse(otherProf.id);
      await prisma.activity.create({
        data: {
          title: 'Heap of someone else',
          instructionsMd: '',
          config: { question: 'x', questionType: 'SHORT_TEXT', hints: [] },
          position: 0,
          lessonId: otherSeed.lesson.id,
          mainTopicId: otherSeed.topic.id,
        },
      });

      const res = await request(profApp).get('/api/activities/importable').query({
        courseId: seed.course.id,
        page: 1,
        pageSize: 25,
        search: 'heap',
      });

      expect(res.body.total).toBe(1);
      expect(res.body.data[0].title).toBe('Heap insertion');
    });
  });
});
