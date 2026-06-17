import { describe, expect, it } from 'vitest';
import { getNavForUser } from '@/lib/rbac/nav';

describe('QM nav RBAC', () => {
  const admin = { id: 'a1', role: 'ADMIN' as const };
  const unitAdmin = { id: 'u1', role: 'UNIT_ADMIN' as const, authorizedUnits: ['COSC'] };
  const instructor = { id: 'i1', role: 'INSTRUCTOR' as const };

  it('includes core workspace links for authorized roles', () => {
    for (const user of [admin, unitAdmin, instructor]) {
      const keys = getNavForUser(user).map((item) => item.key);
      expect(keys).toContain('courses');
      expect(keys).toContain('questions');
      expect(keys).toContain('assessments');
    }
  });

  it('includes variants workflow nav for instructor and up', () => {
    expect(getNavForUser(instructor).some((item) => item.key === 'variants')).toBe(true);
  });

  it('does not include a QM bug reports nav item (triage is in Core)', () => {
    expect(getNavForUser(admin).some((item) => item.key === 'bug-reports')).toBe(false);
  });
});
