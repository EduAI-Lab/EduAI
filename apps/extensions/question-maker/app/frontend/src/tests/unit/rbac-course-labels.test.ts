import { describe, expect, it } from 'vitest';
import {
  formatCourseAccessLevel,
  formatCourseRelationship,
  getCourseRelationship,
} from '@/lib/rbac/course-labels';
import type { Course } from '@/types/question';

describe('course RBAC labels', () => {
  it('formats access levels for course cards', () => {
    expect(formatCourseAccessLevel('admin')).toBe('Admin access');
    expect(formatCourseAccessLevel('unit')).toBe('Unit scope');
    expect(formatCourseAccessLevel('ta')).toBe('TA access');
  });

  it('distinguishes owner vs shared courses', () => {
    const course = { id: 1, name: 'COSC 111', code: 'COSC111', userId: 'owner-1' } as Course;
    expect(getCourseRelationship(course, 'owner-1')).toBe('owner');
    expect(getCourseRelationship(course, 'other-1')).toBe('shared');
    expect(formatCourseRelationship('shared')).toBe('Shared course');
  });
});
