import { describe, expect, it } from 'vitest';
import {
  mapCoreAdminBugReportRow,
  mapBugReportSummary,
  mapAdminBugReportRow,
  UI_TO_CORE_BUG_STATUS,
} from '../../src/utils/bugReportMappers.js';

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

  it('falls back to a lowercased raw status string for an unknown Core status', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-5',
      status: 'SOME_NEW_STATUS',
      description: 'Unmapped status',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    expect(row.status).toBe('some_new_status');
  });

  it('defaults status to "unhandled" when the field is absent entirely', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-6',
      description: 'No status at all',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    expect(row.status).toBe('unhandled');
  });

  it('treats a non-object context as empty and defaults userId to "unknown"', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-7',
      status: 'UNHANDLED',
      description: 'No context, no user',
      isAnonymous: false,
      userId: null,
      createdAt: '2026-06-24T00:00:00.000Z',
      context: 'not-an-object',
    });

    expect(row.userId).toBe('unknown');
    expect(row.courseOfferingId).toBeNull();
    expect(row.moduleId).toBeNull();
    expect(row.lessonId).toBeNull();
    expect(row.activityId).toBeNull();
  });

  it('treats an array context as empty (not a valid context object)', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-8',
      status: 'RESOLVED',
      description: 'Array context',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-24T00:00:00.000Z',
      context: ['not', 'an', 'object'],
    });

    expect(row.courseOfferingId).toBeNull();
  });

  it('derives hasConsoleLogs/hasNetworkLogs/hasScreenshot from content when the flag is absent', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-9',
      status: 'UNHANDLED',
      description: 'Has attachments',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-24T00:00:00.000Z',
      consoleLogs: 'some logs',
      networkLogs: '',
      screenshot: null,
    });

    expect(row.hasConsoleLogs).toBe(true);
    expect(row.hasNetworkLogs).toBe(false);
    expect(row.hasScreenshot).toBe(false);
  });

  it('honors an explicit hasX flag over inferring from content', () => {
    const row = mapCoreAdminBugReportRow({
      id: 'br-10',
      status: 'UNHANDLED',
      description: 'Explicit flags win',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-24T00:00:00.000Z',
      consoleLogs: null,
      hasConsoleLogs: true,
    });

    expect(row.hasConsoleLogs).toBe(true);
  });
});

describe('mapBugReportSummary', () => {
  it('projects a bug report row into the compact summary shape', () => {
    const summary = mapBugReportSummary({
      id: 'br-1',
      status: 'unhandled',
      createdAt: '2026-06-17T00:00:00.000Z',
      isAnonymous: true,
      courseOfferingId: 7,
      moduleId: 2,
      lessonId: null,
      activityId: null,
    });

    expect(summary).toEqual({
      id: 'br-1',
      status: 'unhandled',
      createdAt: '2026-06-17T00:00:00.000Z',
      isAnonymous: true,
      context: {
        courseOfferingId: 7,
        moduleId: 2,
        lessonId: null,
        activityId: null,
      },
    });
  });

  it('defaults every context field to null when absent', () => {
    const summary = mapBugReportSummary({ id: 'br-2', status: 'resolved', createdAt: 'x', isAnonymous: false });

    expect(summary.context).toEqual({
      courseOfferingId: null,
      moduleId: null,
      lessonId: null,
      activityId: null,
    });
  });
});

describe('mapAdminBugReportRow', () => {
  it('maps a fully-populated non-anonymous row, preferring activity.title', () => {
    const row = mapAdminBugReportRow({
      id: 'br-1',
      description: 'Broken button',
      bugType: 'UI_DISPLAY',
      status: 'unhandled',
      consoleLogs: 'logs',
      networkLogs: 'net',
      screenshot: 'data:image/png;base64,xxx',
      pageUrl: '/course/1',
      userAgent: 'UA',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z',
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com', role: 'STUDENT' },
      courseOfferingId: 7,
      moduleId: 2,
      lessonId: 3,
      activityId: 4,
      module: { title: 'Module Title' },
      lesson: { title: 'Lesson Title' },
      activity: { title: 'Activity Title', config: { question: 'What is 2+2?' } },
    });

    expect(row.reporterName).toBe('Alice');
    expect(row.reporterEmail).toBe('alice@example.com');
    expect(row.reporterRole).toBe('STUDENT');
    expect(row.user).toEqual({ id: 'user-1', name: 'Alice', email: 'alice@example.com', role: 'STUDENT' });
    expect(row.moduleTitle).toBe('Module Title');
    expect(row.lessonTitle).toBe('Lesson Title');
    expect(row.activityTitle).toBe('Activity Title');
    expect(row.courseTitle).toBeNull();
  });

  it('masks reporter identity for anonymous rows but keeps userId/role internal fields', () => {
    const row = mapAdminBugReportRow({
      id: 'br-2',
      description: 'Anon report',
      status: 'in progress',
      isAnonymous: true,
      userId: 'user-2',
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z',
      user: { id: 'user-2', name: 'Bob', email: 'bob@example.com', role: 'INSTRUCTOR' },
    });

    expect(row.reporterName).toBe('Anonymous');
    expect(row.reporterEmail).toBeNull();
    expect(row.user.name).toBeNull();
    expect(row.user.email).toBeNull();
    // Role is not identity-masked in this mapper.
    expect(row.user.role).toBe('INSTRUCTOR');
  });

  it('falls back to config.prompt when title and config.question are absent', () => {
    const row = mapAdminBugReportRow({
      id: 'br-3',
      description: 'Fallback to prompt',
      status: 'unhandled',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z',
      activity: { config: { prompt: 'Write a haiku' } },
    });

    expect(row.activityTitle).toBe('Write a haiku');
  });

  it('returns null activityTitle when activity, title, and config are all absent', () => {
    const row = mapAdminBugReportRow({
      id: 'br-4',
      description: 'No activity at all',
      status: 'unhandled',
      isAnonymous: false,
      userId: 'user-1',
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z',
    });

    expect(row.activityTitle).toBeNull();
  });

  it('falls back to row.userId and null identity fields when user relation is absent', () => {
    const row = mapAdminBugReportRow({
      id: 'br-5',
      description: 'No user relation loaded',
      status: 'unhandled',
      isAnonymous: false,
      userId: 'user-9',
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z',
    });

    expect(row.user).toEqual({ id: 'user-9', name: null, email: null, role: null });
    expect(row.reporterName).toBeNull();
    expect(row.reporterRole).toBeNull();
  });
});

describe('UI_TO_CORE_BUG_STATUS', () => {
  it('maps every UI status string to its Core enum', () => {
    expect(UI_TO_CORE_BUG_STATUS).toEqual({
      unhandled: 'UNHANDLED',
      'in progress': 'IN_PROGRESS',
      resolved: 'RESOLVED',
    });
  });
});
