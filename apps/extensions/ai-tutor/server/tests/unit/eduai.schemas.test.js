/**
 * Regression tests for EduAI Zod schemas against Core's actual response shapes.
 *
 * Bug: EduAiEnrollmentSchema required `id: z.string()` but Core's
 * GET /api/courses/:id/enrollments never emits an `id` field — it maps each
 * enrollment to { studentId, studentEmail, studentName, enrolledAt, isActive, role }.
 * Every Zod parse threw Required on the `id` path, causing listEduAiCourseEnrollments
 * to always throw a 502.
 */
import { describe, it, expect } from 'vitest';
import {
  EduAiCourseSchema,
  EduAiCourseListSchema,
  EduAiEnrollmentSchema,
  EduAiEnrollmentListSchema,
} from '../../src/schemas/eduai.js';

// ─── EduAiCourseSchema ────────────────────────────────────────────────────────

const CORE_COURSE = {
  id: 'course-cuid-1',
  code: 'COSC 101',
  name: 'Intro to CS',
  isPublished: true,
  isActive: true,
};

describe('EduAiCourseSchema — isPublished (#477)', () => {
  it('parses isPublished: true from a Core course response', () => {
    const result = EduAiCourseSchema.parse(CORE_COURSE);
    expect(result.isPublished).toBe(true);
  });

  it('parses isPublished: false', () => {
    const result = EduAiCourseSchema.parse({ ...CORE_COURSE, isPublished: false });
    expect(result.isPublished).toBe(false);
  });

  it('accepts a course with no isPublished field (optional — pre-existing Core courses)', () => {
    const { isPublished: _, ...withoutFlag } = CORE_COURSE;
    expect(() => EduAiCourseSchema.parse(withoutFlag)).not.toThrow();
    const result = EduAiCourseSchema.parse(withoutFlag);
    expect(result.isPublished).toBeUndefined();
  });

  it('parses a course list envelope containing isPublished', () => {
    const result = EduAiCourseListSchema.parse({ courses: [CORE_COURSE] });
    expect(result.courses[0].isPublished).toBe(true);
  });
});

// ─── EduAiEnrollmentSchema ────────────────────────────────────────────────────

// Core's actual enrollment response shape (no id field)
const CORE_ENROLLMENT = {
  studentId: 'user-cuid-student-1',
  studentEmail: 'student@example.com',
  studentName: 'Test Student',
  enrolledAt: '2025-01-15T10:00:00.000Z',
  isActive: true,
  role: 'STUDENT',
};

describe('EduAiEnrollmentSchema', () => {
  it('parses a Core enrollment object that has no id field without throwing', () => {
    expect(() => EduAiEnrollmentSchema.parse(CORE_ENROLLMENT)).not.toThrow();
  });

  it('preserves all Core enrollment fields on a successful parse', () => {
    const result = EduAiEnrollmentSchema.parse(CORE_ENROLLMENT);
    expect(result.studentId).toBe('user-cuid-student-1');
    expect(result.studentEmail).toBe('student@example.com');
    expect(result.studentName).toBe('Test Student');
    expect(result.isActive).toBe(true);
    expect(result.role).toBe('STUDENT');
  });

  it('parses an enrollment list envelope with no id fields', () => {
    expect(() =>
      EduAiEnrollmentListSchema.parse({ enrollments: [CORE_ENROLLMENT] })
    ).not.toThrow();
  });

  it('returns a typed enrollments array from the list envelope', () => {
    const result = EduAiEnrollmentListSchema.parse({ enrollments: [CORE_ENROLLMENT] });
    expect(result.enrollments).toHaveLength(1);
    expect(result.enrollments[0].studentId).toBe('user-cuid-student-1');
  });
});
