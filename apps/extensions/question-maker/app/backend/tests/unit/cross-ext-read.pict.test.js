/**
 * PICT adapter (#1189, census § S10): cross-ext-read — Question Maker half.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../../src/config/settings.js', () => ({
  config: {
    coreUrl: 'http://core.test/api',
    eduaiApiKey: 'test-key',
  },
}));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const rows = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests/models/cross-ext-read.cases.json'), 'utf8'),
).filter((row) => row.Ext === 'question-maker');

const { crossExtReadOracle } = await import(
  path.join(repoRoot, 'tests/models/cross-ext-read.oracle.ts')
);

const {
  getCourseFromCore,
  getTopicByIdFromCore,
  listCoursesFromCore,
} = await import('../../src/services/coreApiService.js');

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn());
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockFetchFor(row) {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation(async (url, init = {}) => {
    const href = String(url);
    const hasCookie = Boolean(init.headers?.cookie);
    const hasBearer = Boolean(init.headers?.Authorization);

    if (row.CoreState === 'core-down-5xx') {
      return jsonResponse(503, { error: 'unavailable' });
    }

    if (href.includes('/topics/')) {
      if (row.CoreState === 'absent-404' || row.CoreState === 'soft-deleted') {
        return jsonResponse(404, { error: 'Not found' });
      }
      return jsonResponse(200, { id: 'topic-1', name: 'Week 1' });
    }

    if (href.includes('/courses?') || /\/courses$/.test(href.replace(/\?.*$/, ''))) {
      // list
      if (row.CoreState === 'absent-404' || row.CoreState === 'soft-deleted') {
        return jsonResponse(200, { data: [], total: 0, page: 1, pageSize: 200 });
      }
      if (hasCookie && !hasBearer) {
        if (row.CallerEnrolled === 'yes') {
          return jsonResponse(200, {
            data: [{ id: 'core-1', isPublished: true, callerEnrollmentRole: 'INSTRUCTOR' }],
            total: 1,
            page: 1,
            pageSize: 200,
          });
        }
        return jsonResponse(200, { data: [], total: 0, page: 1, pageSize: 200 });
      }
      return jsonResponse(200, {
        data: [{ id: 'core-1', isPublished: true }],
        total: 1,
        page: 1,
        pageSize: 200,
      });
    }

    // single course
    if (row.CoreState === 'absent-404' || row.CoreState === 'soft-deleted') {
      return jsonResponse(404, { error: 'Not found' });
    }
    if (hasCookie && !hasBearer && row.CallerEnrolled === 'no') {
      return jsonResponse(403, { error: 'Forbidden' });
    }
    return jsonResponse(200, { id: 'core-1', isPublished: true, name: 'Algo' });
  });
}

async function runQm(row) {
  mockFetchFor(row);
  const cookie = 'session=abc';

  if (row.DataKind === 'enrollment-role') {
    try {
      const courses = await listCoursesFromCore(cookie, { all: true });
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
    } catch (err) {
      if (err.status >= 500) {
        return { outcome: 'null', coreStatus: 'unavailable', reason: 'core-down' };
      }
      throw err;
    }
  }

  if (row.DataKind === 'topic') {
    try {
      const topic = await getTopicByIdFromCore('core-1', 'topic-1');
      if (!topic) {
        return {
          outcome: 'null',
          coreStatus: 'ok',
          reason: row.CoreState === 'soft-deleted' ? 'soft-deleted' : 'absent',
        };
      }
      return { outcome: 'resolved', coreStatus: 'ok', reason: 'ok' };
    } catch (err) {
      if (err.status >= 500) {
        return { outcome: 'null', coreStatus: 'unavailable', reason: 'core-down' };
      }
      throw err;
    }
  }

  if (row.DataKind === 'publish-state') {
    // Publish truth is service-key field read (preferCookie: false)
    try {
      const course = await getCourseFromCore('core-1', { preferCookie: false });
      if (!course) {
        return { outcome: 'published-false', coreStatus: 'ok', reason: 'absent' };
      }
      return {
        outcome: course.isPublished ? 'published-true' : 'published-false',
        coreStatus: 'ok',
        reason: 'ok',
      };
    } catch (err) {
      if (err.status >= 500) {
        return { outcome: 'published-false', coreStatus: 'unavailable', reason: 'core-down' };
      }
      throw err;
    }
  }

  // course-field
  try {
    if (row.Auth === 'session-cookie') {
      const courses = await listCoursesFromCore(cookie, { all: true });
      const hit = courses.find((c) => c.id === 'core-1');
      if (!hit) {
        return {
          outcome: 'null',
          coreStatus: 'ok',
          reason:
            row.CallerEnrolled === 'no' && row.CoreState === 'present'
              ? 'silent-omission'
              : row.CoreState === 'soft-deleted'
                ? 'soft-deleted'
                : 'absent',
        };
      }
      return { outcome: 'resolved', coreStatus: 'ok', reason: 'ok' };
    }

    const course = await getCourseFromCore('core-1', { preferCookie: false });
    if (!course) {
      return {
        outcome: 'null',
        coreStatus: 'ok',
        reason: row.CoreState === 'soft-deleted' ? 'soft-deleted' : 'absent',
      };
    }
    return { outcome: 'resolved', coreStatus: 'ok', reason: 'ok' };
  } catch (err) {
    if (err.status >= 500) {
      return { outcome: 'null', coreStatus: 'unavailable', reason: 'core-down' };
    }
    if (err.status === 403 || err.status === 404) {
      return { outcome: 'null', coreStatus: 'ok', reason: 'silent-omission' };
    }
    throw err;
  }
}

describe.each(rows.map((row, index) => [index, row]))(
  'cross-ext-read PICT QM row #%i',
  (index, row) => {
    const testFn = row.DataKind === 'material' ? it.skip : it;
    testFn(
      `${row.DataKind}/${row.Auth}/${row.CoreState}/${row.CallerEnrolled} matches oracle`,
      async () => {
        const expected = crossExtReadOracle(row);
        const actual = await runQm(row);
        expect(actual).toEqual(expected);
      },
    );
  },
);
