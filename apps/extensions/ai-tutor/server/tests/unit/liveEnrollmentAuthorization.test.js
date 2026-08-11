import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: { findUnique: vi.fn() },
    courseEnrollment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    courseInstructor: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiCourseEnrollmentsServiceKey: vi.fn(),
}));

import { prisma } from '../../src/config/database.js';
import { listEduAiCourseEnrollmentsServiceKey } from '../../src/services/eduaiClient.js';
import { authorizeLiveStudentEnrollment } from '../../src/services/enrollmentSync.js';

const COURSE = { id: 1, coreOfferingId: 'core-course-1' };
const ACTIVE_STUDENT = {
  studentId: 'student-1',
  studentEmail: 'student@example.com',
  studentName: 'Student One',
  enrolledAt: '2026-01-01T00:00:00.000Z',
  isActive: true,
  role: 'STUDENT',
};
const ACTIVE_TA = { ...ACTIVE_STUDENT, role: 'TA' };
const ACTIVE_INSTRUCTOR = { ...ACTIVE_STUDENT, studentId: 'prof-1', role: 'INSTRUCTOR' };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.courseOffering.findUnique.mockResolvedValue(COURSE);
  prisma.courseEnrollment.findMany.mockResolvedValue([{ userId: 'student-1', role: 'STUDENT' }]);
  prisma.courseEnrollment.findUnique.mockResolvedValue(null);
  prisma.courseEnrollment.createMany.mockResolvedValue({ count: 0 });
  prisma.courseEnrollment.deleteMany.mockResolvedValue({ count: 1 });
  prisma.courseEnrollment.update.mockResolvedValue({});
  prisma.courseInstructor.findMany.mockResolvedValue([]);
  prisma.courseInstructor.findUnique.mockResolvedValue(null);
  prisma.courseInstructor.createMany.mockResolvedValue({ count: 0 });
  prisma.courseInstructor.deleteMany.mockResolvedValue({ count: 0 });
});

describe('authorizeLiveStudentEnrollment', () => {
  it('authorizes and mirrors only an exact active Core INSTRUCTOR role', async () => {
    listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_INSTRUCTOR]);
    prisma.courseInstructor.findUnique.mockResolvedValue({ userId: 'prof-1' });

    const result = await authorizeLiveStudentEnrollment(1, 'prof-1', {
      allowedRoles: ['INSTRUCTOR'],
    });

    expect(result).toEqual({ allowed: true, state: 'allowed', role: 'INSTRUCTOR' });
    expect(prisma.courseInstructor.createMany).toHaveBeenCalledWith({
      data: [{ courseOfferingId: 1, userId: 'prof-1', role: 'LEAD' }],
      skipDuplicates: true,
    });
  });

  it('allows a local STUDENT row when Core confirms active STUDENT enrollment', async () => {
    listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_STUDENT]);
    prisma.courseEnrollment.findUnique.mockResolvedValue({ role: 'STUDENT' });

    const result = await authorizeLiveStudentEnrollment(1, 'student-1');

    expect(result).toEqual({ allowed: true, state: 'allowed', role: 'STUDENT' });
    expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledWith('core-course-1', {
      signal: expect.any(AbortSignal),
    });
  });

  it('mirrors an active Core STUDENT row before allowing the operation', async () => {
    listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_STUDENT]);
    prisma.courseEnrollment.findMany.mockResolvedValue([]);
    prisma.courseEnrollment.findUnique.mockResolvedValue({ role: 'STUDENT' });

    const result = await authorizeLiveStudentEnrollment(1, 'student-1');

    expect(result).toEqual({ allowed: true, state: 'allowed', role: 'STUDENT' });
    expect(prisma.courseEnrollment.createMany).toHaveBeenCalledWith({
      data: [{ courseOfferingId: 1, userId: 'student-1', role: 'STUDENT' }],
      skipDuplicates: true,
    });
  });

  it('consults Core on every sensitive authorization check without the read-path TTL', async () => {
    listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([ACTIVE_STUDENT]);
    prisma.courseEnrollment.findUnique.mockResolvedValue({ role: 'STUDENT' });

    await authorizeLiveStudentEnrollment(1, 'student-1');
    await authorizeLiveStudentEnrollment(1, 'student-1');

    expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledTimes(2);
  });

  it('prunes a stale local student row when Core no longer lists the user', async () => {
    listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([]);

    const result = await authorizeLiveStudentEnrollment(1, 'student-1');

    expect(result).toMatchObject({ allowed: false, state: 'denied', role: null });
    expect(prisma.courseEnrollment.deleteMany).toHaveBeenCalled();
  });

  it('updates a local STUDENT row to TA and denies the student operation', async () => {
    listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([{ ...ACTIVE_TA }]);
    prisma.courseEnrollment.findUnique.mockResolvedValue({ role: 'TA' });

    const result = await authorizeLiveStudentEnrollment(1, 'student-1');

    expect(result).toEqual({ allowed: false, state: 'denied', role: 'TA' });
    expect(prisma.courseEnrollment.update).toHaveBeenCalledWith({
      where: { courseOfferingId_userId: { courseOfferingId: 1, userId: 'student-1' } },
      data: { role: 'TA' },
    });
  });

  it('prunes a local row when Core marks the enrollment inactive', async () => {
    listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([
      { ...ACTIVE_STUDENT, isActive: false },
    ]);

    const result = await authorizeLiveStudentEnrollment(1, 'student-1');

    expect(result).toMatchObject({ allowed: false, state: 'denied', role: null });
    expect(prisma.courseEnrollment.deleteMany).toHaveBeenCalled();
  });

  it.each([
    ['network failure', new Error('Core unavailable')],
    ['timeout', Object.assign(new Error('deadline exceeded'), { name: 'TimeoutError' })],
    ['malformed roster', null],
  ])('fails closed as unavailable on Core %s without local writes', async (_label, response) => {
    if (response === null) {
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue(null);
    } else {
      listEduAiCourseEnrollmentsServiceKey.mockRejectedValue(response);
    }

    const result = await authorizeLiveStudentEnrollment(1, 'student-1');

    expect(result).toEqual({ allowed: false, state: 'unavailable', role: null });
    expect(prisma.courseEnrollment.createMany).not.toHaveBeenCalled();
    expect(prisma.courseEnrollment.update).not.toHaveBeenCalled();
    expect(prisma.courseEnrollment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.courseEnrollment.findUnique).not.toHaveBeenCalled();
  });
});
