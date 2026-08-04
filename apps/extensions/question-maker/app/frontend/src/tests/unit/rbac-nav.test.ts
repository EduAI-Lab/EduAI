import { describe, expect, it } from 'vitest';
import { getNavForUser, getNavSecondaryForUser } from '@/lib/rbac/nav';

describe('QM nav RBAC', () => {
  const admin = { id: 'a1', role: 'ADMIN' as const };
  const unitAdmin = { id: 'u1', role: 'UNIT_ADMIN' as const, authorizedUnits: ['COSC'] };
  const instructor = { id: 'i1', role: 'INSTRUCTOR' as const };

  it('includes core workspace links for authorized roles', () => {
    for (const user of [admin, unitAdmin, instructor]) {
      const keys = getNavForUser(user).map((item) => item.key);
      expect(keys).toContain('dashboard');
      expect(keys).toContain('courses');
      expect(keys).toContain('library');
    }
  });

  it('points workspace links at live routes, not legacy redirects', () => {
    // /home and /assessment-variant are redirect-only since the course-centric
    // redesign; nav must not send users through them.
    const hrefs = getNavForUser(admin).map((item) => item.href);
    for (const href of hrefs) {
      expect(href).not.toMatch(/^\/home/);
      expect(href).not.toMatch(/^\/assessment-variant/);
    }
  });

  it('includes bug reports nav for admin only', () => {
    expect(getNavForUser(admin).some((item) => item.key === 'bug-reports')).toBe(true);
    expect(getNavForUser(instructor).some((item) => item.key === 'bug-reports')).toBe(false);
    expect(getNavForUser(unitAdmin).some((item) => item.key === 'bug-reports')).toBe(false);
  });

  it('returns nothing for a signed-out user', () => {
    expect(getNavForUser(null)).toEqual([]);
    expect(getNavSecondaryForUser(null)).toEqual([]);
  });

  it('puts Help in the secondary nav', () => {
    expect(getNavSecondaryForUser(admin).map((item) => item.key)).toEqual(['help']);
  });

  it('re-exports every nav helper from the rbac barrel', async () => {
    // Today's consumers import from `lib/rbac/nav` directly, so a helper missing
    // from the barrel fails only for the next caller that reaches for the index.
    const barrel = await import('@/lib/rbac');
    const nav = await import('@/lib/rbac/nav');
    for (const name of Object.keys(nav)) {
      expect(barrel, `${name} is missing from lib/rbac/index.ts`).toHaveProperty(name);
    }
  });
});
