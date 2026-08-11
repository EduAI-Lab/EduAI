/**
 * PICT adapter (#1189, census § S10): cross-ext-read — AI Tutor half.
 * Mocks eduaiClient and exercises courseResolver / topic safe-fetch against
 * the shared oracle. `material` has no AT client — those rows are skipped
 * (census one-liner); soft-delete leak class for materials is covered by
 * material-visibility (#1180).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../../src/services/eduaiClient.js', () => ({
  fetchCoreCourseSafe: vi.fn(),
  fetchCoreTopicSafe: vi.fn(),
  listEduAiCourses: vi.fn(),
  listEduAiCoursesServiceKey: vi.fn(),
}));

import {
  fetchCoreCourseSafe,
  fetchCoreTopicSafe,
  listEduAiCourses,
  listEduAiCoursesServiceKey,
} from '../../src/services/eduaiClient.js';
import {
  indexCoreCoursesById,
  resolveCoreCourseById,
  resolveCoreCourseList,
  resolveIsPublished,
} from '../../src/services/courseResolver.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const rows = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests/models/cross-ext-read.cases.json'), 'utf8'),
).filter((row) => row.Ext === 'ai-tutor');

const { crossExtReadOracle } = await import(
  path.join(repoRoot, 'tests/models/cross-ext-read.oracle.ts')
);

beforeEach(() => {
  vi.mocked(fetchCoreCourseSafe).mockReset();
  vi.mocked(fetchCoreTopicSafe).mockReset();
  vi.mocked(listEduAiCourses).mockReset();
  vi.mocked(listEduAiCoursesServiceKey).mockReset();
  process.env.EDUAI_API_KEY = 'test-key';
});

function mockCoreState(kind, { entity = 'course' } = {}) {
  const course = { id: 'core-1', isPublished: true, name: 'Algo' };
  const topic = { id: 'topic-1', name: 'Week 1' };

  if (kind === 'core-down-5xx') {
    const err = Object.assign(new Error('Core down'), { status: 503 });
    vi.mocked(fetchCoreCourseSafe).mockRejectedValue(err);
    vi.mocked(fetchCoreTopicSafe).mockRejectedValue(err);
    vi.mocked(listEduAiCourses).mockRejectedValue(err);
    vi.mocked(listEduAiCoursesServiceKey).mockRejectedValue(err);
    return;
  }
  if (kind === 'absent-404' || kind === 'soft-deleted') {
    vi.mocked(fetchCoreCourseSafe).mockResolvedValue(null);
    vi.mocked(fetchCoreTopicSafe).mockResolvedValue(null);
    vi.mocked(listEduAiCourses).mockResolvedValue([]);
    vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([]);
    return;
  }
  // present
  vi.mocked(fetchCoreCourseSafe).mockResolvedValue(course);
  vi.mocked(fetchCoreTopicSafe).mockResolvedValue(topic);
  vi.mocked(listEduAiCoursesServiceKey).mockResolvedValue([course]);
  if (entity === 'enrolled-list') {
    vi.mocked(listEduAiCourses).mockResolvedValue([
      { ...course, callerEnrollmentRole: 'STUDENT' },
    ]);
  } else {
    vi.mocked(listEduAiCourses).mockResolvedValue([]);
  }
}

async function runAt(row) {
  mockCoreState(row.CoreState, {
    entity: row.CallerEnrolled === 'yes' ? 'enrolled-list' : 'empty-list',
  });

  if (row.DataKind === 'enrollment-role') {
    const { courses, coreUnavailable } = await resolveCoreCourseList({ cookie: 'session=abc' });
    if (coreUnavailable) {
      return { outcome: 'null', coreStatus: 'unavailable', reason: 'core-down' };
    }
    const hit = courses.find((c) => c.id === 'core-1');
    if (hit?.callerEnrollmentRole) {
      return { outcome: 'resolved', coreStatus: 'ok', reason: 'ok' };
    }
    if (row.CoreState === 'absent-404') {
      return { outcome: 'null', coreStatus: 'ok', reason: 'absent' };
    }
    if (row.CoreState === 'soft-deleted') {
      return { outcome: 'null', coreStatus: 'ok', reason: 'soft-deleted' };
    }
    return { outcome: 'null', coreStatus: 'ok', reason: 'not-enrolled' };
  }

  if (row.DataKind === 'publish-state') {
    // Publish truth is always the service-key field path (Auth dim is combinatorial).
    const { course, coreUnavailable } = await resolveCoreCourseById('core-1');
    if (coreUnavailable) {
      return { outcome: 'published-false', coreStatus: 'unavailable', reason: 'core-down' };
    }
    const byId = indexCoreCoursesById(course ? [course] : []);
    const published = resolveIsPublished({ coreOfferingId: 'core-1' }, byId);
    return {
      outcome: published ? 'published-true' : 'published-false',
      coreStatus: 'ok',
      reason: course ? 'ok' : 'absent',
    };
  }

  if (row.DataKind === 'topic') {
    try {
      const topic = await fetchCoreTopicSafe('core-1', 'topic-1');
      if (!topic) {
        return {
          outcome: 'null',
          coreStatus: 'ok',
          reason: row.CoreState === 'soft-deleted' ? 'soft-deleted' : 'absent',
        };
      }
      return { outcome: 'resolved', coreStatus: 'ok', reason: 'ok' };
    } catch {
      return { outcome: 'null', coreStatus: 'unavailable', reason: 'core-down' };
    }
  }

  // course-field
  if (row.Auth === 'session-cookie') {
    const { courses, coreUnavailable } = await resolveCoreCourseList({ cookie: 'session=abc' });
    if (coreUnavailable) {
      return { outcome: 'null', coreStatus: 'unavailable', reason: 'core-down' };
    }
    const hit = courses.find((c) => c.id === 'core-1');
    if (!hit) {
      return {
        outcome: 'null',
        coreStatus: 'ok',
        reason: row.CallerEnrolled === 'no' && row.CoreState === 'present'
          ? 'silent-omission'
          : row.CoreState === 'soft-deleted'
            ? 'soft-deleted'
            : 'absent',
      };
    }
    return { outcome: 'resolved', coreStatus: 'ok', reason: 'ok' };
  }

  const { course, coreUnavailable } = await resolveCoreCourseById('core-1');
  if (coreUnavailable) {
    return { outcome: 'null', coreStatus: 'unavailable', reason: 'core-down' };
  }
  if (!course) {
    return {
      outcome: 'null',
      coreStatus: 'ok',
      reason: row.CoreState === 'soft-deleted' ? 'soft-deleted' : 'absent',
    };
  }
  return { outcome: 'resolved', coreStatus: 'ok', reason: 'ok' };
}

describe.each(rows.map((row, index) => [index, row]))(
  'cross-ext-read PICT AT row #%i',
  (index, row) => {
    const testFn = row.DataKind === 'material' ? it.skip : it;
    testFn(
      `${row.DataKind}/${row.Auth}/${row.CoreState}/${row.CallerEnrolled} matches oracle`,
      async () => {
        const expected = crossExtReadOracle(row);
        const actual = await runAt(row);
        expect(actual).toEqual(expected);
      },
    );
  },
);
