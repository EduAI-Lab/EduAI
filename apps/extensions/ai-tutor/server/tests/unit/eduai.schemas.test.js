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
  EduAiEnrollmentSchema,
  EduAiEnrollmentListSchema,
} from '../../src/schemas/eduai.js';

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
