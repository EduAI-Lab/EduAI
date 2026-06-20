import { describe, expect, it } from 'vitest';
import {
  canAssignTaRole,
  canCreateCourse,
  canManageContent,
  canManageEnrollments,
  canSubmitBugReport,
  canViewCourseAnalytics,
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

  it('allows TA to view submissions but not analytics', () => {
    expect(canViewCourseSubmissions({ id: '1', role: 'TA' })).toBe(true);
    expect(canViewCourseAnalytics({ id: '1', role: 'TA' })).toBe(false);
  });

  it('allows enrollment management for instructor and unit admin', () => {
    expect(canManageEnrollments({ id: '1', role: 'INSTRUCTOR' })).toBe(true);
    expect(canManageEnrollments({ id: '1', role: 'UNIT_ADMIN' })).toBe(true);
    expect(canManageEnrollments({ id: '1', role: 'TA' })).toBe(false);
    expect(canAssignTaRole({ id: '1', role: 'INSTRUCTOR' })).toBe(true);
  });

  it('allows course creation for instructor and unit admin', () => {
    expect(canCreateCourse({ id: '1', role: 'INSTRUCTOR' })).toBe(true);
    expect(canCreateCourse({ id: '1', role: 'UNIT_ADMIN' })).toBe(true);
    expect(canCreateCourse({ id: '1', role: 'TA' })).toBe(false);
  });

  it('limits bug reports to student and instructor', () => {
    expect(canSubmitBugReport({ id: '1', role: 'STUDENT' })).toBe(true);
    expect(canSubmitBugReport({ id: '1', role: 'INSTRUCTOR' })).toBe(true);
    expect(canSubmitBugReport({ id: '1', role: 'TA' })).toBe(false);
  });
});

describe('role routing', () => {
  it('routes all five roles to expected shells', () => {
    expect(routeFromRouting('STUDENT')).toBe('/student');
    expect(routeFromRouting('INSTRUCTOR')).toBe('/instructor');
    expect(routeFromRouting('TA')).toBe('/instructor');
    expect(routeFromRouting('UNIT_ADMIN')).toBe('/instructor');
    expect(routeFromRouting('ADMIN')).toBe('/admin');
  });
});
