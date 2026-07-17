import { describe, expect, it } from 'vitest';
import {
  canAssignTaRole,
  canCreateCourse,
  canManageContent,
  canManageEnrollments,
  canSubmitBugReport,
  canViewCourseAnalytics,
  canViewCourseFeedback,
  canViewCourseSubmissions,
  resolvePlatformCourseAccess,
} from '~/lib/rbac';
import { routeForRole as routeFromRouting } from '~/lib/role-routing';

describe('rbac permissions', () => {
  it('resolves platform course access by role', () => {
    expect(resolvePlatformCourseAccess({ id: '1', role: 'ADMIN' })).toBe('admin');
    expect(resolvePlatformCourseAccess({ id: '1', role: 'UNIT_ADMIN' })).toBe('unit');
    expect(resolvePlatformCourseAccess({ id: '1', role: 'INSTRUCTOR' })).toBe('instructor');
    expect(resolvePlatformCourseAccess({ id: '1', role: 'TA' })).toBe('ta');
    expect(resolvePlatformCourseAccess({ id: '1', role: 'STUDENT' })).toBe('student');
  });

  it('gates content management for TA read-only shell', () => {
    expect(canManageContent({ id: '1', role: 'INSTRUCTOR' })).toBe(true);
    expect(canManageContent({ id: '1', role: 'TA' })).toBe(false);
    expect(canManageContent({ id: '1', role: 'UNIT_ADMIN' })).toBe(true);
  });

  it('grants TA read parity on submissions and analytics (#938)', () => {
    expect(canViewCourseSubmissions({ id: '1', role: 'TA' })).toBe(true);
    expect(canViewCourseFeedback({ id: '1', role: 'TA' })).toBe(true);
    expect(canViewCourseAnalytics({ id: '1', role: 'TA' })).toBe(true);
  });

  it('hides course feedback from students (#784)', () => {
    expect(canViewCourseFeedback({ id: '1', role: 'STUDENT' })).toBe(false);
  });

  it('allows enrollment management for instructor and unit admin', () => {
    expect(canManageEnrollments({ id: '1', role: 'INSTRUCTOR' })).toBe(true);
    expect(canManageEnrollments({ id: '1', role: 'UNIT_ADMIN' })).toBe(true);
    expect(canManageEnrollments({ id: '1', role: 'TA' })).toBe(false);
    expect(canAssignTaRole({ id: '1', role: 'INSTRUCTOR' })).toBe(true);
  });

  it('disallows local course creation — courses are created in EduAI Core (#632)', () => {
    expect(canCreateCourse({ id: '1', role: 'INSTRUCTOR' })).toBe(false);
    expect(canCreateCourse({ id: '1', role: 'UNIT_ADMIN' })).toBe(false);
    expect(canCreateCourse({ id: '1', role: 'ADMIN' })).toBe(false);
  });

  it('allows any authenticated role to submit a bug report (#938)', () => {
    expect(canSubmitBugReport({ id: '1', role: 'STUDENT' })).toBe(true);
    expect(canSubmitBugReport({ id: '1', role: 'INSTRUCTOR' })).toBe(true);
    expect(canSubmitBugReport({ id: '1', role: 'TA' })).toBe(true);
    expect(canSubmitBugReport({ id: '1', role: 'UNIT_ADMIN' })).toBe(true);
    expect(canSubmitBugReport({ id: '1', role: 'ADMIN' })).toBe(true);
  });
});

describe('role routing', () => {
  it('routes all five roles to the shared dashboard (#938)', () => {
    expect(routeFromRouting('STUDENT')).toBe('/dashboard');
    expect(routeFromRouting('INSTRUCTOR')).toBe('/dashboard');
    expect(routeFromRouting('TA')).toBe('/dashboard');
    expect(routeFromRouting('UNIT_ADMIN')).toBe('/dashboard');
    expect(routeFromRouting('ADMIN')).toBe('/dashboard');
  });
});
