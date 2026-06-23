import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: { findUnique: vi.fn() },
    courseEnrollment: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiCourseEnrollmentsServiceKey: vi.fn(),
}));

import { prisma } from '../../src/config/database.js';
import { listEduAiCourseEnrollmentsServiceKey } from '../../src/services/eduaiClient.js';
import { syncCourseEnrollments } from '../../src/services/enrollmentSync.js';

const COURSE = {
  id: 1,
  externalId: 'core-course-cuid-1',
  externalSource: 'EDUAI',
};

const ACTIVE_ENROLLMENT = {
  studentId: 'user-cuid-1',
  studentEmail: 'student@example.com',
  studentName: 'Test Student',
  enrolledAt: '2025-01-15T10:00:00.000Z',
  isActive: true,
  role: 'STUDENT',
};

const TA_ENROLLMENT = {
  studentId: 'user-cuid-ta',
  studentEmail: 'ta@example.com',
  studentName: 'Test TA',
  enrolledAt: '2025-01-15T10:00:00.000Z',
  isActive: true,
  role: 'TA',
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.courseOffering.findUnique.mockResolvedValue(COURSE);
  prisma.courseEnrollment.findMany.mockResolvedValue([]);
  prisma.courseEnrollment.createMany.mockResolvedValue({ count: 0 });
  prisma.courseEnrollment.deleteMany.mockResolvedValue({ count: 0 });
  prisma.courseEnrollment.update.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncCourseEnrollments', () => {
  describe('early return guards', () => {
    it('returns zeros when courseOfferingId is not a finite number', async () => {
      const result = await syncCourseEnrollments(NaN);
      expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });
      expect(prisma.courseOffering.findUnique).not.toHaveBeenCalled();
    });

    it('returns zeros when course is not found', async () => {
      prisma.courseOffering.findUnique.mockResolvedValue(null);
      const result = await syncCourseEnrollments(1);
      expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });
    });

    it('returns zeros when course has no externalId', async () => {
      prisma.courseOffering.findUnique.mockResolvedValue({ ...COURSE, externalId: null });
      const result = await syncCourseEnrollments(1);
      expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });
      expect(listEduAiCourseEnrollmentsServiceKey).not.toHaveBeenCalled();
    });

    it('returns zeros when externalSource is not EDUAI', async () => {
      prisma.courseOffering.findUnique.mockResolvedValue({ ...COURSE, externalSource: 'CANVAS' });
      const result = await syncCourseEnrollments(1);
      expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });
      expect(listEduAiCourseEnrollmentsServiceKey).not.toHaveBeenCalled();
    });

    it('returns zeros when Core returns no active enrollments (guards against data wipe)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([]);
      const result = await syncCourseEnrollments(1);
      expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });
      expect(prisma.courseEnrollment.createMany).not.toHaveBeenCalled();
      expect(prisma.courseEnrollment.deleteMany).not.toHaveBeenCalled();
    });

    it('returns zeros when all Core enrollments are inactive', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        { ...ACTIVE_ENROLLMENT, isActive: false },
      ]);
      const result = await syncCourseEnrollments(1);
      expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });
    });
  });

  describe('options.course shortcut', () => {
    it('skips the DB lookup when options.course is provided', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      await syncCourseEnrollments(1, { course: COURSE });
      expect(prisma.courseOffering.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('create path', () => {
    it('creates enrollment rows with role from Core', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).toHaveBeenCalledWith({
        data: [{ courseOfferingId: 1, userId: 'user-cuid-1', role: 'STUDENT' }],
        skipDuplicates: true,
      });
      expect(result).toEqual({ synced: 1, created: 1, updated: 0, deleted: 0, errors: [] });
    });

    it('does not create TA enrollment rows (#578)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([TA_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });
    });

    it('defaults role to STUDENT when Core omits it', async () => {
      const enrollmentNoRole = { ...ACTIVE_ENROLLMENT, role: undefined };
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([enrollmentNoRole]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).toHaveBeenCalledWith({
        data: [{ courseOfferingId: 1, userId: 'user-cuid-1', role: 'STUDENT' }],
        skipDuplicates: true,
      });
    });

    it('skips createMany when all active users already exist locally', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([{ userId: 'user-cuid-1', role: 'STUDENT' }]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 1, created: 0, updated: 0, deleted: 0, errors: [] });
    });
  });

  describe('update path (role changed)', () => {
    it('does not promote students to TA when Core reports TA (#578)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        { ...ACTIVE_ENROLLMENT, studentId: 'user-cuid-1', role: 'TA' },
      ]);
      prisma.courseEnrollment.findMany.mockResolvedValue([{ userId: 'user-cuid-1', role: 'STUDENT' }]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.update).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [] });
    });

    it('does not update when role is unchanged', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([{ userId: 'user-cuid-1', role: 'STUDENT' }]);

      await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.update).not.toHaveBeenCalled();
    });

    it('updates local TA to STUDENT when Core demotes back to STUDENT (#569)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        { ...ACTIVE_ENROLLMENT, studentId: 'user-cuid-ta', role: 'STUDENT' },
      ]);
      prisma.courseEnrollment.findMany.mockResolvedValue([{ userId: 'user-cuid-ta', role: 'TA' }]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.update).toHaveBeenCalledWith({
        where: { courseOfferingId_userId: { courseOfferingId: 1, userId: 'user-cuid-ta' } },
        data: { role: 'STUDENT' },
      });
      expect(result).toEqual({ synced: 1, created: 0, updated: 1, deleted: 0, errors: [] });
    });
  });

  describe('delete path', () => {
    it('deletes local STUDENT enrollment rows absent from Core active list', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([
        { userId: 'user-cuid-1', role: 'STUDENT' },
        { userId: 'user-cuid-stale', role: 'STUDENT' },
      ]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.deleteMany).toHaveBeenCalledWith({
        where: { courseOfferingId: 1, userId: { in: ['user-cuid-stale'] } },
      });
      expect(result).toEqual({ synced: 1, created: 0, updated: 0, deleted: 1, errors: [] });
    });

    it('does not delete local TA rows when syncing STUDENT enrollments only (#578)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([
        { userId: 'user-cuid-1', role: 'STUDENT' },
        { userId: 'user-cuid-ta', role: 'TA' },
      ]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.deleteMany).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 1, created: 0, updated: 0, deleted: 0, errors: [] });
    });

    it('skips deleteMany when no stale STUDENT rows exist', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([{ userId: 'user-cuid-1', role: 'STUDENT' }]);

      await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('combined create + delete', () => {
    it('creates new and deletes stale in the same sync pass', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        ACTIVE_ENROLLMENT,
        { ...ACTIVE_ENROLLMENT, studentId: 'user-cuid-2', studentEmail: 'student2@example.com' },
      ]);
      prisma.courseEnrollment.findMany.mockResolvedValue([
        { userId: 'user-cuid-1', role: 'STUDENT' },
        { userId: 'user-cuid-stale', role: 'STUDENT' },
      ]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).toHaveBeenCalledWith({
        data: [{ courseOfferingId: 1, userId: 'user-cuid-2', role: 'STUDENT' }],
        skipDuplicates: true,
      });
      expect(prisma.courseEnrollment.deleteMany).toHaveBeenCalledWith({
        where: { courseOfferingId: 1, userId: { in: ['user-cuid-stale'] } },
      });
      expect(result).toEqual({ synced: 2, created: 1, updated: 0, deleted: 1, errors: [] });
    });
  });

  describe('externalId passed to Core', () => {
    it('calls Core with the course externalId not the local offering id', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);

      await syncCourseEnrollments(1);

      expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledWith('core-course-cuid-1');
    });
  });

  describe('active/inactive filtering', () => {
    it('only syncs active enrollments when upstream contains a mix', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        ACTIVE_ENROLLMENT,
        { ...ACTIVE_ENROLLMENT, studentId: 'user-cuid-inactive', isActive: false },
      ]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).toHaveBeenCalledWith({
        data: [{ courseOfferingId: 1, userId: 'user-cuid-1', role: 'STUDENT' }],
        skipDuplicates: true,
      });
      expect(result).toEqual({ synced: 1, created: 1, updated: 0, deleted: 0, errors: [] });
    });

    it('syncs STUDENT enrollments only (#578)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        ACTIVE_ENROLLMENT,
        { ...ACTIVE_ENROLLMENT, studentId: 'ta-1', role: 'TA' },
        { ...ACTIVE_ENROLLMENT, studentId: 'inst-1', role: 'INSTRUCTOR' },
      ]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).toHaveBeenCalledWith({
        data: [{ courseOfferingId: 1, userId: 'user-cuid-1', role: 'STUDENT' }],
        skipDuplicates: true,
      });
      expect(result.synced).toBe(1);
    });
  });

  describe('error propagation', () => {
    it('propagates errors thrown by the Core client without swallowing them', async () => {
      const err = Object.assign(new Error('EDUAI_API_KEY not configured'), { status: 500 });
      listEduAiCourseEnrollmentsServiceKey.mockRejectedValue(err);

      await expect(syncCourseEnrollments(1)).rejects.toThrow('EDUAI_API_KEY not configured');
      expect(prisma.courseEnrollment.createMany).not.toHaveBeenCalled();
      expect(prisma.courseEnrollment.deleteMany).not.toHaveBeenCalled();
    });
  });
});
