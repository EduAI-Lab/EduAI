/**
 * Unit tests for the eduaiClient.js exports not already covered by the other
 * eduaiClient.*.test.js files (adminUsers, coursesByIds, listCoursesServiceKey,
 * publishState, serviceKey, testableQuestions).
 *
 * This fills the gap called out in EduAI#1216: success AND Core-unavailable
 * error paths for the cross-service HTTP boundary. `globalThis.fetch` is
 * mocked throughout — no real network calls are made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEduAiBaseUrl,
  getEduAiCompletionUrl,
  getEduAiChatUrl,
  postCoreBugReport,
  listCoreAdminBugReports,
  getCoreAdminBugReport,
  patchCoreAdminBugReportStatus,
  listEduAiCourses,
  listEduAiCourseTopics,
  listEduAiCourseEnrollmentsServiceKey,
  patchCoreEnrollmentRole,
  deleteCoreEnrollment,
  fetchCoreCourseSafe,
  fetchCoreTopicSafe,
} from '../../src/services/eduaiClient.js';

beforeEach(() => {
  process.env.EDUAI_BASE_URL = 'http://eduai.test/api';
  process.env.CORE_URL = 'http://core.test';
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  delete process.env.EDUAI_BASE_URL;
  delete process.env.CORE_URL;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function okJson(body) {
  return { ok: true, status: 200, text: () => Promise.resolve(''), json: () => Promise.resolve(body) };
}

function notOk(status, text = '') {
  return { ok: false, status, text: () => Promise.resolve(text) };
}

describe('base URL helpers', () => {
  it('getEduAiBaseUrl strips a trailing slash', () => {
    process.env.EDUAI_BASE_URL = 'http://eduai.test/api/';
    expect(getEduAiBaseUrl()).toBe('http://eduai.test/api');
  });

  it('getEduAiBaseUrl falls back to the default when unset', () => {
    delete process.env.EDUAI_BASE_URL;
    expect(getEduAiBaseUrl()).toBe('http://localhost:5174/api');
  });

  it('getEduAiCompletionUrl / getEduAiChatUrl are derived from the base URL', () => {
    expect(getEduAiCompletionUrl()).toBe('http://eduai.test/api/completion');
    expect(getEduAiChatUrl()).toBe('http://eduai.test/api/chat');
  });
});

describe('postCoreBugReport', () => {
  it('throws when EDUAI_API_KEY is not configured', async () => {
    delete process.env.EDUAI_API_KEY;
    await expect(postCoreBugReport('user-1', { description: 'x' })).rejects.toThrow(
      'EDUAI_API_KEY not configured',
    );
  });

  it('POSTs to Core with the service key and AI_TUTOR source, returning null on success', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', mockFetch);

    const result = await postCoreBugReport('user-1', {
      description: 'Broken',
      isAnonymous: true,
      context: { courseOfferingId: 1 },
    });

    expect(result).toBeNull();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/bug-reports');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer svc-key');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({ source: 'AI_TUTOR', userId: 'user-1', description: 'Broken', isAnonymous: true });
  });

  it('throws with status when Core responds non-ok', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(400, 'Bad description')));

    await expect(postCoreBugReport('user-1', { description: 'x' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('listCoreAdminBugReports', () => {
  it('throws 401 without a cookie', async () => {
    await expect(listCoreAdminBugReports('')).rejects.toMatchObject({ status: 401 });
  });

  it('requests Core admin bug reports with query params and returns the parsed body', async () => {
    const payload = { reports: [{ id: 'br-1' }] };
    const mockFetch = vi.fn().mockResolvedValue(okJson(payload));
    vi.stubGlobal('fetch', mockFetch);

    const result = await listCoreAdminBugReports('cookie=abc', { source: 'AI_TUTOR', limit: 50, offset: 10 });

    expect(result).toEqual(payload);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/admin/bug-reports?source=AI_TUTOR&limit=50&offset=10');
    expect(opts.headers.cookie).toBe('cookie=abc');
  });

  it('throws with status on a non-ok Core response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(403, 'Forbidden')));
    await expect(listCoreAdminBugReports('cookie=abc')).rejects.toMatchObject({ status: 403 });
  });
});

describe('getCoreAdminBugReport', () => {
  it('throws 401 without a cookie', async () => {
    await expect(getCoreAdminBugReport('', 'br-1')).rejects.toMatchObject({ status: 401 });
  });

  it('requests the single report and returns its body', async () => {
    const payload = { id: 'br-1', description: 'full detail' };
    const mockFetch = vi.fn().mockResolvedValue(okJson(payload));
    vi.stubGlobal('fetch', mockFetch);

    const result = await getCoreAdminBugReport('cookie=abc', 'br-1');

    expect(result).toEqual(payload);
    expect(mockFetch.mock.calls[0][0]).toBe('http://core.test/api/admin/bug-reports/br-1');
  });

  it('URL-encodes the bug report id', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okJson({ id: 'br/weird id' }));
    vi.stubGlobal('fetch', mockFetch);

    await getCoreAdminBugReport('cookie=abc', 'br/weird id');

    expect(mockFetch.mock.calls[0][0]).toBe(
      `http://core.test/api/admin/bug-reports/${encodeURIComponent('br/weird id')}`,
    );
  });

  it('throws with status on a non-ok Core response (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(404, 'not found')));
    await expect(getCoreAdminBugReport('cookie=abc', 'br-missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('patchCoreAdminBugReportStatus', () => {
  it('throws 401 without a cookie', async () => {
    await expect(patchCoreAdminBugReportStatus('', 'br-1', 'RESOLVED')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('PATCHes the status and returns the updated row', async () => {
    const updated = { id: 'br-1', status: 'RESOLVED' };
    const mockFetch = vi.fn().mockResolvedValue(okJson(updated));
    vi.stubGlobal('fetch', mockFetch);

    const result = await patchCoreAdminBugReportStatus('cookie=abc', 'br-1', 'RESOLVED');

    expect(result).toEqual(updated);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/admin/bug-reports/br-1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ status: 'RESOLVED' });
  });

  it('throws with status on a non-ok Core response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(400, 'INVALID_STATUS')));
    await expect(patchCoreAdminBugReportStatus('cookie=abc', 'br-1', 'BOGUS')).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('listEduAiCourses (success path via cookie)', () => {
  it('returns the parsed course page data on a valid response', async () => {
    const courses = [{ id: 'c1', name: 'Course One' }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okJson({ data: courses, total: 1, page: 1, pageSize: 200 })),
    );

    const result = await listEduAiCourses({ cookie: 'session=abc' });

    expect(result).toEqual(courses);
  });
});

describe('listEduAiCourseTopics', () => {
  it('returns [] without hitting the network when externalCourseId is falsy', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    await expect(listEduAiCourseTopics('')).resolves.toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when EDUAI_API_KEY is not configured', async () => {
    delete process.env.EDUAI_API_KEY;
    await expect(listEduAiCourseTopics('core-1')).rejects.toThrow('EDUAI_API_KEY not configured');
  });

  it('returns the parsed topics array on success', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    const topics = [{ id: 't1', courseId: 'core-1', name: 'Topic', createdAt: 'x', updatedAt: 'y' }];
    const mockFetch = vi.fn().mockResolvedValue(okJson({ topics }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await listEduAiCourseTopics('core-1');

    expect(result).toEqual(topics);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://eduai.test/api/courses/core-1/topics');
    expect(opts.headers.Authorization).toBe('Bearer svc-key');
  });

  it('throws a 502 when the response fails schema validation', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ notTopics: true })));

    await expect(listEduAiCourseTopics('core-1')).rejects.toMatchObject({ status: 502 });
  });

  it('surfaces a non-ok upstream response as a status-bearing error', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(503, 'Core unavailable')));

    await expect(listEduAiCourseTopics('core-1')).rejects.toMatchObject({ status: 503 });
  });
});

describe('listEduAiCourseEnrollmentsServiceKey', () => {
  it('returns [] without hitting the network when externalCourseId is falsy', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    await expect(listEduAiCourseEnrollmentsServiceKey(null)).resolves.toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when EDUAI_API_KEY is not configured', async () => {
    delete process.env.EDUAI_API_KEY;
    await expect(listEduAiCourseEnrollmentsServiceKey('core-1')).rejects.toThrow(
      'EDUAI_API_KEY not configured',
    );
  });

  it('returns the parsed enrollments array on success', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    const enrollments = [
      { studentId: 's1', studentEmail: 'a@b.com', studentName: 'A', enrolledAt: 'x', isActive: true },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ enrollments })));

    const result = await listEduAiCourseEnrollmentsServiceKey('core-1');

    expect(result).toEqual(enrollments);
  });

  it('throws a 502 when the response fails schema validation', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ nope: true })));

    await expect(listEduAiCourseEnrollmentsServiceKey('core-1')).rejects.toMatchObject({ status: 502 });
  });

  it('surfaces a non-ok upstream response as a status-bearing error', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(500, 'boom')));

    await expect(listEduAiCourseEnrollmentsServiceKey('core-1')).rejects.toMatchObject({ status: 500 });
  });
});

describe('patchCoreEnrollmentRole', () => {
  it('throws 401 without a cookie', async () => {
    await expect(patchCoreEnrollmentRole('core-1', 'e1', 'TA', '')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('PATCHes the enrollment role and returns the response body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okJson({ id: 'e1', role: 'TA' }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await patchCoreEnrollmentRole('core-1', 'e1', 'TA', 'session=abc');

    expect(result).toEqual({ id: 'e1', role: 'TA' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://eduai.test/api/courses/core-1/enrollments/e1');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers.cookie).toBe('session=abc');
    expect(JSON.parse(opts.body)).toEqual({ role: 'TA' });
  });

  it('throws with status on a non-ok Core response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(403, 'Forbidden')));
    await expect(
      patchCoreEnrollmentRole('core-1', 'e1', 'TA', 'session=abc'),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('deleteCoreEnrollment', () => {
  it('throws 401 without a cookie', async () => {
    await expect(deleteCoreEnrollment('core-1', 'e1', '')).rejects.toMatchObject({ status: 401 });
  });

  it('DELETEs the enrollment', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', mockFetch);

    const result = await deleteCoreEnrollment('core-1', 'e1', 'session=abc');

    expect(result).toBeNull();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://eduai.test/api/courses/core-1/enrollments/e1');
    expect(opts.method).toBe('DELETE');
  });

  it('throws with status on a non-ok Core response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(404, 'not found')));
    await expect(deleteCoreEnrollment('core-1', 'e1', 'session=abc')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('fetchCoreCourseSafe', () => {
  it('throws when EDUAI_API_KEY is not configured', async () => {
    delete process.env.EDUAI_API_KEY;
    await expect(fetchCoreCourseSafe('core-1')).rejects.toThrow('EDUAI_API_KEY not configured');
  });

  it('returns the course on success', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ id: 'core-1', name: 'Course' })));

    const result = await fetchCoreCourseSafe('core-1');

    expect(result).toEqual({ id: 'core-1', name: 'Course' });
  });

  it('returns null on a 404 instead of throwing', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(404, 'gone')));

    await expect(fetchCoreCourseSafe('core-missing')).resolves.toBeNull();
  });

  it('rethrows on a non-404 upstream failure', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(500, 'server error')));

    await expect(fetchCoreCourseSafe('core-1')).rejects.toMatchObject({ status: 500 });
  });

  it('forwards an AbortSignal so a hung Core call can be bounded', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    const mockFetch = vi.fn().mockResolvedValue(okJson({ id: 'core-1' }));
    vi.stubGlobal('fetch', mockFetch);
    const signal = AbortSignal.timeout(1000);

    await fetchCoreCourseSafe('core-1', { signal });

    expect(mockFetch.mock.calls[0][1].signal).toBe(signal);
  });
});

describe('fetchCoreTopicSafe', () => {
  it('throws when EDUAI_API_KEY is not configured', async () => {
    delete process.env.EDUAI_API_KEY;
    await expect(fetchCoreTopicSafe('core-1', 'topic-1')).rejects.toThrow('EDUAI_API_KEY not configured');
  });

  it('returns the topic on success', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ id: 'topic-1', name: 'Topic' })));

    const result = await fetchCoreTopicSafe('core-1', 'topic-1');

    expect(result).toEqual({ id: 'topic-1', name: 'Topic' });
  });

  it('returns null on a 404 instead of throwing', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(404, 'gone')));

    await expect(fetchCoreTopicSafe('core-1', 'topic-missing')).resolves.toBeNull();
  });

  it('rethrows on a non-404 upstream failure', async () => {
    process.env.EDUAI_API_KEY = 'svc-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notOk(502, 'bad gateway')));

    await expect(fetchCoreTopicSafe('core-1', 'topic-1')).rejects.toMatchObject({ status: 502 });
  });
});
