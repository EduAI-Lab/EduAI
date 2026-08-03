/**
 * Server-side search + filters on GET /api/courses, and GET /api/courses/facets (#1208).
 *
 * The point of these tests: title/code/term/status are Core-owned read-throughs
 * with no local column, so every one of these dimensions is matched against the
 * Core catalog and pushed into SQL as an id set. That makes two things worth
 * pinning hard — that `total` reflects the FILTERED set (or the pager lies), and
 * that a filter can only ever narrow the role scope, never widen it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  makeProfessor,
  makeStudent,
  makeAdmin,
  makeTA,
  truncateAll,
  seedMinimalCourse,
  prisma,
} from '../helpers.js';

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findEduAiCourseById: vi.fn(),
    listEduAiCourses: vi.fn(),
    listEduAiCoursesServiceKey: vi.fn(),
    fetchCoreCourseSafe: vi.fn(),
  };
});

import {
  fetchCoreCourseSafe,
  listEduAiCourses,
  listEduAiCoursesServiceKey,
} from '../../src/services/eduaiClient.js';

vi.mock('../../src/services/policyService.js', () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
  getPolicies: vi.fn().mockResolvedValue({ 'instructors.canCreateCourses': true }),
  invalidatePolicyCache: vi.fn(),
  __resetPolicyServiceState: vi.fn(),
}));

vi.mock('../../src/services/topicSync.js', () => ({
  syncExternalCourseTopics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/enrollmentSync.js', () => ({
  AUTO_SYNC_TTL_MS: 30_000,
  AUTO_SYNC_TIMEOUT_MS: 3_000,
  syncCourseEnrollments: vi.fn().mockResolvedValue({ synced: 0, created: 0, deleted: 0, errors: [] }),
}));

describe('GET /api/courses — search and filters (#1208)', () => {
  let prof;
  let profApp;
  /** @type {Record<string, {course: any, module: any, lesson: any, topic: any}>} */
  let seeds;
  /** Core catalog entries keyed the same way. */
  let catalog;

  const PAGE = 'page=1&pageSize=200';

  beforeEach(async () => {
    await truncateAll();
    prof = makeProfessor();

    seeds = {
      computing: await seedMinimalCourse(prof.id),
      data: await seedMinimalCourse(prof.id),
      algebra: await seedMinimalCourse(prof.id),
      chem: await seedMinimalCourse(prof.id),
    };

    // `callerEnrollmentRole: 'NONE'` is the non-match sentinel used across the
    // course tests — it keeps the auto-import mirror from creating enrollments.
    catalog = [
      {
        id: seeds.computing.course.coreOfferingId,
        name: 'Intro to Computing',
        code: 'COSC 111',
        term: 'W1',
        year: 2026,
        department: 'Computer Science',
        isPublished: true,
        callerEnrollmentRole: 'NONE',
      },
      {
        id: seeds.data.course.coreOfferingId,
        name: 'Data Structures',
        code: 'COSC 221',
        term: 'W2',
        year: 2026,
        department: 'Computer Science',
        isPublished: false,
        callerEnrollmentRole: 'NONE',
      },
      {
        id: seeds.algebra.course.coreOfferingId,
        name: 'Linear Algebra',
        code: 'MATH 221',
        term: 'W1',
        year: 2026,
        department: 'Mathematics',
        isPublished: true,
        callerEnrollmentRole: 'NONE',
      },
      {
        id: seeds.chem.course.coreOfferingId,
        name: 'Organic Chemistry',
        code: 'CHEM 203',
        term: 'S1',
        year: 2025,
        department: 'Chemistry',
        isPublished: true,
        callerEnrollmentRole: 'NONE',
      },
    ];

    vi.mocked(listEduAiCourses).mockResolvedValue(catalog);
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue(catalog);
    vi.mocked(fetchCoreCourseSafe).mockImplementation(async (id) =>
      catalog.find((c) => c.id === id) ?? null,
    );

    profApp = await createApp({ mockUser: prof });
  });

  /** Local course ids in a response, for order-independent comparison. */
  const idsOf = (res) => res.body.data.map((c) => c.id).sort((a, b) => a - b);
  const expectIds = (res, expected) =>
    expect(idsOf(res)).toEqual([...expected].sort((a, b) => a - b));

  // ── search ────────────────────────────────────────────────────────

  it('narrows by search on the title, and total reflects the filtered set', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&search=computing`);

    expect(res.status).toBe(200);
    expectIds(res, [seeds.computing.course.id]);
    // The pager reads `total` — if this stayed 4 it would render pages of
    // results that the filter has already removed.
    expect(res.body.total).toBe(1);
  });

  it('matches on the course code, not just the title', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&search=MATH`);

    expect(res.status).toBe(200);
    expectIds(res, [seeds.algebra.course.id]);
  });

  it('is case-insensitive and matches substrings', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&search=cOsC%202`);

    expect(res.status).toBe(200);
    expectIds(res, [seeds.data.course.id]);
  });

  it('returns an empty page (not an error) when nothing matches', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&search=astrophysics`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('treats a blank search as no search at all', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&search=%20%20`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
  });

  // ── term / status filters ────────────────────────────────────────

  it('filters by term', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&term=W1::2026`);

    expect(res.status).toBe(200);
    expectIds(res, [seeds.computing.course.id, seeds.algebra.course.id]);
    expect(res.body.total).toBe(2);
  });

  it('ORs multiple values within the term dimension', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&term=W2::2026&term=S1::2025`);

    expect(res.status).toBe(200);
    expectIds(res, [seeds.data.course.id, seeds.chem.course.id]);
  });

  it('filters by status', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&status=draft`);

    expect(res.status).toBe(200);
    expectIds(res, [seeds.data.course.id]);
  });

  it('ANDs across dimensions rather than unioning them', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&search=COSC&term=W1::2026`);

    expect(res.status).toBe(200);
    expectIds(res, [seeds.computing.course.id]);
    expect(res.body.total).toBe(1);
  });

  it('paginates consistently over a filtered set', async () => {
    const first = await request(profApp).get('/api/courses?page=1&pageSize=1&term=W1::2026');
    const second = await request(profApp).get('/api/courses?page=2&pageSize=1&term=W1::2026');

    expect(first.body.total).toBe(2);
    expect(second.body.total).toBe(2);
    expect(first.body.data).toHaveLength(1);
    expect(second.body.data).toHaveLength(1);
    expect(first.body.data[0].id).not.toBe(second.body.data[0].id);
  });

  // ── contract regressions ─────────────────────────────────────────

  it('returns every course when no filter params are sent', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.data).toHaveLength(4);
  });

  it('rejects an over-long search with 400', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&search=${'x'.repeat(201)}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SEARCH_TOO_LONG');
  });

  it('rejects an unknown status value with 400 rather than an empty list', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&status=bogus`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILTER_INVALID');
  });

  it('rejects a repeated search param with 400', async () => {
    const res = await request(profApp).get(`/api/courses?${PAGE}&search=a&search=b`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SEARCH_INVALID');
  });

  // ── fail-soft ────────────────────────────────────────────────────

  it('returns an empty result and flags the outage when Core is unavailable', async () => {
    vi.mocked(listEduAiCoursesServiceKey).mockRejectedValue(new Error('core down'));

    const res = await request(profApp).get(`/api/courses?${PAGE}&search=computing`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    // Without this header the client would render "no courses match" for what is
    // actually an outage.
    expect(res.headers['x-core-status']).toBe('unavailable');
  });

  // ── authorization: filters must never widen scope ────────────────

  describe('scoping', () => {
    it('a student cannot reach an unpublished course via ?status=draft', async () => {
      const student = makeStudent();
      // Enrolled in BOTH the published and the unpublished course.
      await prisma.courseEnrollment.createMany({
        data: [
          { courseOfferingId: seeds.computing.course.id, userId: student.id, role: 'STUDENT' },
          { courseOfferingId: seeds.data.course.id, userId: student.id, role: 'STUDENT' },
        ],
      });
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/courses?${PAGE}&status=draft`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('a student cannot reach a course they are not enrolled in via search', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seeds.computing.course.id, userId: student.id, role: 'STUDENT' },
      });
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get(`/api/courses?${PAGE}&search=algebra`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('an instructor cannot reach a course they do not lead via search', async () => {
      const other = makeProfessor();
      const otherApp = await createApp({ mockUser: other });

      const res = await request(otherApp).get(`/api/courses?${PAGE}&search=computing`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('filters AND with a unit admin\'s department scope instead of widening it', async () => {
      const unitAdmin = makeProfessor({ role: 'UNIT_ADMIN', authorizedUnits: ['Mathematics'] });
      const unitApp = await createApp({ mockUser: unitAdmin });

      // Unscoped: only the Mathematics course is visible.
      const all = await request(unitApp).get(`/api/courses?${PAGE}`);
      expectIds(all, [seeds.algebra.course.id]);

      // A search naming a course outside the unit must not pull it in.
      const res = await request(unitApp).get(`/api/courses?${PAGE}&search=computing`);
      expect(res.body.data).toEqual([]);
    });

    it('applies filters across the TA union', async () => {
      const ta = makeTA();
      await prisma.courseEnrollment.createMany({
        data: [
          { courseOfferingId: seeds.data.course.id, userId: ta.id, role: 'TA' },
          { courseOfferingId: seeds.algebra.course.id, userId: ta.id, role: 'STUDENT' },
        ],
      });
      const taApp = await createApp({ mockUser: ta });

      const unfiltered = await request(taApp).get(`/api/courses?${PAGE}`);
      expectIds(unfiltered, [seeds.data.course.id, seeds.algebra.course.id]);

      const res = await request(taApp).get(`/api/courses?${PAGE}&search=algebra`);
      expectIds(res, [seeds.algebra.course.id]);
    });

    it('admin search narrows the list but still anchors the whole catalog', async () => {
      const admin = makeAdmin();
      const adminApp = await createApp({ mockUser: admin });

      const res = await request(adminApp).get(`/api/courses?${PAGE}&search=chemistry`);

      expect(res.status).toBe(200);
      expectIds(res, [seeds.chem.course.id]);
      // Create-on-open must not be narrowed by the search: every catalog course
      // still needs a local anchor row.
      const anchored = await prisma.courseOffering.count();
      expect(anchored).toBe(4);
    });
  });

  // ── progress filter ──────────────────────────────────────────────

  describe('?progress=', () => {
    let student;
    let studentApp;

    async function addActivity(seed) {
      return prisma.activity.create({
        data: {
          lessonId: seed.lesson.id,
          mainTopicId: seed.topic.id,
          instructionsMd: 'Instructions',
          config: { question: 'Q?', questionType: 'MCQ' },
          position: 0,
        },
      });
    }

    beforeEach(async () => {
      student = makeStudent();
      // Enrolled in the three published courses.
      await prisma.courseEnrollment.createMany({
        data: [
          { courseOfferingId: seeds.computing.course.id, userId: student.id, role: 'STUDENT' },
          { courseOfferingId: seeds.algebra.course.id, userId: student.id, role: 'STUDENT' },
          { courseOfferingId: seeds.chem.course.id, userId: student.id, role: 'STUDENT' },
        ],
      });
      studentApp = await createApp({ mockUser: student });

      // computing → completed (1/1), algebra → not-started (0/2), chem → no activities.
      const done = await addActivity(seeds.computing);
      await prisma.submission.create({
        data: { userId: student.id, activityId: done.id, attemptNumber: 1, isCorrect: true, response: {} },
      });
      await addActivity(seeds.algebra);
      await addActivity(seeds.algebra);
    });

    it('returns only completed courses', async () => {
      const res = await request(studentApp).get(`/api/courses?${PAGE}&progress=completed`);

      expect(res.status).toBe(200);
      expectIds(res, [seeds.computing.course.id]);
      expect(res.body.total).toBe(1);
    });

    it('returns only not-started courses', async () => {
      const res = await request(studentApp).get(`/api/courses?${PAGE}&progress=not-started`);

      expect(res.status).toBe(200);
      expectIds(res, [seeds.algebra.course.id]);
    });

    it('returns in-progress courses once some but not all activities are done', async () => {
      const [first] = await prisma.activity.findMany({
        where: { lesson: { module: { courseOfferingId: seeds.algebra.course.id } } },
        orderBy: { id: 'asc' },
      });
      await prisma.submission.create({
        data: { userId: student.id, activityId: first.id, attemptNumber: 1, isCorrect: true, response: {} },
      });

      const res = await request(studentApp).get(`/api/courses?${PAGE}&progress=in-progress`);

      expectIds(res, [seeds.algebra.course.id]);
    });

    it('excludes a course with no published activities from every bucket', async () => {
      for (const bucket of ['not-started', 'in-progress', 'completed']) {
        const res = await request(studentApp).get(`/api/courses?${PAGE}&progress=${bucket}`);
        expect(idsOf(res), bucket).not.toContain(seeds.chem.course.id);
      }
    });

    it('ORs multiple buckets', async () => {
      const res = await request(studentApp).get(
        `/api/courses?${PAGE}&progress=completed&progress=not-started`,
      );

      expectIds(res, [seeds.computing.course.id, seeds.algebra.course.id]);
    });

    it('combines with a catalog filter', async () => {
      const res = await request(studentApp).get(
        `/api/courses?${PAGE}&progress=completed&term=S1::2025`,
      );

      // computing is completed but sits in W1::2026, so the AND yields nothing.
      expect(res.body.data).toEqual([]);
    });

    it('is ignored, not rejected, for a role whose rows carry no progress', async () => {
      const res = await request(profApp).get(`/api/courses?${PAGE}&progress=completed`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
    });

    it('rejects an unknown bucket with 400', async () => {
      const res = await request(studentApp).get(`/api/courses?${PAGE}&progress=halfway`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FILTER_INVALID');
    });
  });

  // ── GET /api/courses/facets ──────────────────────────────────────

  describe('GET /api/courses/facets', () => {
    it('offers every term across the whole accessible set, not just one page', async () => {
      // One course per page — the facets must still span all four.
      const page = await request(profApp).get('/api/courses?page=1&pageSize=1');
      expect(page.body.data).toHaveLength(1);

      const res = await request(profApp).get('/api/courses/facets');

      expect(res.status).toBe(200);
      expect(res.body.terms).toEqual(['W2::2026', 'W1::2026', 'S1::2025']);
    });

    it('lists the statuses present', async () => {
      const res = await request(profApp).get('/api/courses/facets');

      expect(res.body.statuses).toEqual(['published', 'draft']);
    });

    it('scopes to the caller — a student sees only their own courses\' terms', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seeds.chem.course.id, userId: student.id, role: 'STUDENT' },
      });
      const studentApp = await createApp({ mockUser: student });

      const res = await request(studentApp).get('/api/courses/facets');

      expect(res.body.terms).toEqual(['S1::2025']);
      expect(res.body.statuses).toEqual(['published']);
    });

    it('offers progress buckets to a student but not an instructor', async () => {
      const student = makeStudent();
      await prisma.courseEnrollment.create({
        data: { courseOfferingId: seeds.chem.course.id, userId: student.id, role: 'STUDENT' },
      });
      const studentApp = await createApp({ mockUser: student });

      // Only buckets the list can actually return are offered. Previously this
      // was the fixed three-value list, which handed the student filters that
      // each emptied their list — `progressBucket` is null for a course with no
      // published activities and `?progress=` excludes those from every bucket.
      const forStudent = await request(studentApp).get('/api/courses/facets');
      for (const bucket of forStudent.body.progress) {
        const listed = await request(studentApp).get(`/api/courses?page=1&progress=${bucket}`);
        expect(listed.body.total).toBeGreaterThan(0);
      }

      const forProf = await request(profApp).get('/api/courses/facets');
      expect(forProf.body.progress).toEqual([]);
    });

    it('returns empty facets rather than 500ing when Core is unavailable', async () => {
      vi.mocked(listEduAiCoursesServiceKey).mockRejectedValue(new Error('core down'));

      const res = await request(profApp).get('/api/courses/facets');

      expect(res.status).toBe(200);
      // `coreUnavailable` rides in the body because the client's `http()` wrapper
      // swallows `X-Core-Status` into a toast, so the route never sees it — and
      // without it a fail-closed search renders "No courses match".
      expect(res.body).toEqual({
        terms: [],
        statuses: [],
        progress: [],
        coreUnavailable: true,
      });
      expect(res.headers['x-core-status']).toBe('unavailable');
    });

    it('is not shadowed by GET /courses/:courseId', async () => {
      const res = await request(profApp).get('/api/courses/facets');

      expect(res.status).toBe(200);
      expect(res.body.terms).toBeDefined();
    });

    it('rejects an unauthenticated caller', async () => {
      const anonApp = await createApp({ mockUser: null });

      const res = await request(anonApp).get('/api/courses/facets');

      expect(res.status).toBe(401);
    });
  });
});
