import { describe, expect, it } from 'vitest';
import {
  canApproveVariant,
  canCreateQuestion,
  canManageAssessment,
  canTriageBugReports,
  resolvePlatformCourseAccess,
} from '@/lib/rbac';

describe('QM RBAC permissions', () => {
  const admin = { id: 'a1', role: 'ADMIN' };
  const unitAdmin = { id: 'u1', role: 'UNIT_ADMIN', authorizedUnits: ['COSC'] };
  const instructor = { id: 'i1', role: 'INSTRUCTOR' };

  it('resolves platform course access by role', () => {
    expect(resolvePlatformCourseAccess(admin)).toBe('admin');
    expect(resolvePlatformCourseAccess(unitAdmin)).toBe('unit');
    expect(resolvePlatformCourseAccess(instructor)).toBe('instructor');
  });

  it('allows authoring roles to create questions', () => {
    expect(canCreateQuestion(admin)).toBe(true);
    expect(canCreateQuestion(unitAdmin)).toBe(true);
    expect(canCreateQuestion(instructor)).toBe(true);
  });

  it('restricts variant approval to instructor and up', () => {
    expect(canApproveVariant(admin)).toBe(true);
    expect(canApproveVariant(unitAdmin)).toBe(true);
    expect(canApproveVariant(instructor)).toBe(true);
    expect(canApproveVariant(instructor, 'ta')).toBe(false);
  });

  it('restricts assessment writes to instructor and up', () => {
    expect(canManageAssessment(admin)).toBe(true);
    expect(canManageAssessment(unitAdmin)).toBe(true);
    expect(canManageAssessment(instructor)).toBe(true);
    expect(canManageAssessment(instructor, 'ta')).toBe(false);
  });

  it('allows only ADMIN to triage bug reports', () => {
    expect(canTriageBugReports(admin)).toBe(true);
    expect(canTriageBugReports(unitAdmin)).toBe(false);
    expect(canTriageBugReports(instructor)).toBe(false);
  });

  it('denies authoring when course access is null', () => {
    expect(canCreateQuestion(instructor, null)).toBe(false);
    expect(canManageAssessment(instructor, null)).toBe(false);
  });
});
