import { describe, expect, it } from 'vitest';
import { mapCoreAdminBugReportRow } from '../../src/utils/bugReportMappers.js';

describe('mapCoreAdminBugReportRow', () => {
  it('maps Core status enums to AI Tutor UI labels', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-1',
      status: 'IN_PROGRESS',
      description: 'Example',
      isAnonymous: false,
      userId: 'user-1',
      userEmail: 'a@b.com',
      userName: 'A',
      createdAt: '2026-06-17T00:00:00.000Z',
      context: { courseOfferingId: 7, moduleId: 2 },
    });

    expect(row.status).toBe('in progress');
    expect(row.courseOfferingId).toBe(7);
    expect(row.moduleId).toBe(2);
    expect(row.reporterEmail).toBe('a@b.com');
  });

  it('masks anonymous reporters', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-2',
      status: 'UNHANDLED',
      description: 'Hidden identity',
      isAnonymous: true,
      userId: null,
      createdAt: '2026-06-17T00:00:00.000Z',
    });

    expect(row.isAnonymous).toBe(true);
    expect(row.reporterName).toBe('Anonymous');
    expect(row.reporterEmail).toBeNull();
  });

  it('passes through bugType when present', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-3',
      status: 'UNHANDLED',
      description: 'Feature broken',
      bugType: 'FEATURE_NOT_WORKING',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    expect(row.bugType).toBe('FEATURE_NOT_WORKING');
  });

  it('returns null bugType when field is absent', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-4',
      status: 'RESOLVED',
      description: 'Old report without type',
      isAnonymous: false,
      userId: 'user-2',
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    expect(row.bugType).toBeNull();
  });
});
