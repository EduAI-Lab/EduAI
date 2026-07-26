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
import {
  clearEnrollmentSyncThrottle,
  resetEnrollmentSyncThrottleForTests,
  syncCourseEnrollments,
} from '../../src/services/enrollmentSync.js';

const COURSE = {
  id: 1,
  coreOfferingId: 'core-course-cuid-1',
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
  resetEnrollmentSyncThrottleForTests();
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

    it('returns zeros when course has no coreOfferingId', async () => {
      prisma.courseOffering.findUnique.mockResolvedValue({ ...COURSE, coreOfferingId: null });
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

    it('creates TA enrollment rows (#1065)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([TA_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).toHaveBeenCalledWith({
        data: [{ courseOfferingId: 1, userId: 'user-cuid-ta', role: 'TA' }],
        skipDuplicates: true,
      });
      expect(result).toEqual({ synced: 1, created: 1, updated: 0, deleted: 0, errors: [] });
    });

    it('does not create INSTRUCTOR enrollment rows', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        { ...ACTIVE_ENROLLMENT, studentId: 'inst-1', role: 'INSTRUCTOR' },
      ]);
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
    it('promotes local STUDENT rows to TA when Core reports TA (#1065)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        { ...ACTIVE_ENROLLMENT, studentId: 'user-cuid-1', role: 'TA' },
      ]);
      prisma.courseEnrollment.findMany.mockResolvedValue([{ userId: 'user-cuid-1', role: 'STUDENT' }]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.update).toHaveBeenCalledWith({
        where: { courseOfferingId_userId: { courseOfferingId: 1, userId: 'user-cuid-1' } },
        data: { role: 'TA' },
      });
      expect(result).toEqual({ synced: 1, created: 0, updated: 1, deleted: 0, errors: [] });
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

    it('deletes local TA rows no longer active in Core (#1065)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([
        { userId: 'user-cuid-1', role: 'STUDENT' },
        { userId: 'user-cuid-ta', role: 'TA' },
      ]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.deleteMany).toHaveBeenCalledWith({
        where: { courseOfferingId: 1, userId: { in: ['user-cuid-ta'] } },
      });
      expect(result).toEqual({ synced: 1, created: 0, updated: 0, deleted: 1, errors: [] });
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

  describe('coreOfferingId passed to Core', () => {
    it('calls Core with the course coreOfferingId not the local offering id', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);

      await syncCourseEnrollments(1);

      expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledWith('core-course-cuid-1', {
        signal: undefined,
      });
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

    it('syncs STUDENT and TA enrollments, excluding INSTRUCTOR (#1065)', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
        ACTIVE_ENROLLMENT,
        { ...ACTIVE_ENROLLMENT, studentId: 'ta-1', role: 'TA' },
        { ...ACTIVE_ENROLLMENT, studentId: 'inst-1', role: 'INSTRUCTOR' },
      ]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      const result = await syncCourseEnrollments(1);

      expect(prisma.courseEnrollment.createMany).toHaveBeenCalledWith({
        data: [
          { courseOfferingId: 1, userId: 'user-cuid-1', role: 'STUDENT' },
          { courseOfferingId: 1, userId: 'ta-1', role: 'TA' },
        ],
        skipDuplicates: true,
      });
      expect(result.synced).toBe(2);
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

    it('tags a Core fetch failure with phase "fetch"', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockRejectedValue(new Error('network down'));

      await expect(syncCourseEnrollments(1)).rejects.toMatchObject({ phase: 'fetch' });
    });

    it('tags a local write failure with phase "write"', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);
      prisma.courseEnrollment.createMany.mockRejectedValue(new Error('DB unavailable'));

      await expect(syncCourseEnrollments(1)).rejects.toMatchObject({ phase: 'write' });
    });

    it('passes options.signal through to the Core client', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      const signal = new AbortController().signal;

      await syncCourseEnrollments(1, { signal });

      expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledWith('core-course-cuid-1', { signal });
    });
  });

  describe('options.ttlMs throttling', () => {
    it('skips the Core call when a sync succeeded within the TTL window', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      await syncCourseEnrollments(1, { ttlMs: 30_000 });
      listEduAiCourseEnrollmentsServiceKey.mockClear();

      const result = await syncCourseEnrollments(1, { ttlMs: 30_000 });

      expect(listEduAiCourseEnrollmentsServiceKey).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
    });

    it('calls Core again once the TTL window has elapsed', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000);

      await syncCourseEnrollments(1, { ttlMs: 30_000 });
      listEduAiCourseEnrollmentsServiceKey.mockClear();
      nowSpy.mockReturnValue(1_000 + 30_001);

      await syncCourseEnrollments(1, { ttlMs: 30_000 });

      expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledTimes(1);
      nowSpy.mockRestore();
    });

    it('always calls Core when ttlMs is not passed, regardless of a prior sync', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      await syncCourseEnrollments(1, { ttlMs: 30_000 });
      listEduAiCourseEnrollmentsServiceKey.mockClear();

      await syncCourseEnrollments(1);

      expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledTimes(1);
    });

    it('calls Core again after clearEnrollmentSyncThrottle evicts the throttle entry, even within the TTL window', async () => {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_ENROLLMENT]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);

      await syncCourseEnrollments(1, { ttlMs: 30_000 });
      listEduAiCourseEnrollmentsServiceKey.mockClear();
      clearEnrollmentSyncThrottle(1);

      await syncCourseEnrollments(1, { ttlMs: 30_000 });

      expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledTimes(1);
    });
  });
});
