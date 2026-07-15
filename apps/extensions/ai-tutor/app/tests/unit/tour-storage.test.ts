import { describe, expect, it } from 'vitest';
import {
  canAccessStudentTour,
  resolveSuggestedTourId,
} from '~/lib/tours/tour-storage';

describe('tour access helpers', () => {
  it('allows students on student routes', () => {
    expect(canAccessStudentTour('STUDENT', '/student')).toBe(true);
    expect(canAccessStudentTour('STUDENT', '/student/course/1')).toBe(true);
  });

  it('allows TAs on instructor and student routes', () => {
    expect(canAccessStudentTour('TA', '/instructor')).toBe(true);
    expect(canAccessStudentTour('TA', '/student')).toBe(true);
  });

  it('denies instructors and admins on student and instructor shells', () => {
    expect(canAccessStudentTour('ADMIN', '/student')).toBe(false);
    expect(canAccessStudentTour('INSTRUCTOR', '/student')).toBe(false);
    expect(canAccessStudentTour('UNIT_ADMIN', '/student')).toBe(false);
    expect(canAccessStudentTour('INSTRUCTOR', '/instructor')).toBe(false);
    expect(canAccessStudentTour('ADMIN', '/instructor')).toBe(false);
    expect(canAccessStudentTour('UNIT_ADMIN', '/instructor')).toBe(false);
  });

  it('suggests student-journey for TAs on instructor routes', () => {
    expect(resolveSuggestedTourId('TA', '/instructor')).toBe('student-journey');
  });

  it('suggests lesson help on student lesson routes', () => {
    expect(resolveSuggestedTourId('STUDENT', '/student/lesson/1')).toBe(
      'student-lesson-help',
    );
  });
});
