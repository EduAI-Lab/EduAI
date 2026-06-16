/**
 * Unit tests for coreApiService helpers.
 * Mocks global fetch — no live Core, no DB required.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    coreUrl: 'http://core.test',
    eduaiApiKey: 'test-service-key',
  };
  return { config: cfg, default: cfg };
});

const {
  getCourseTopicsFromCore,
  pushTopicToCore,
  pushQuestionToCore,
  patchQuestionTestableOnCore,
  getCourseEnrollmentsFromCore,
  getCourseFromCore,
  listCoursesFromCore,
  getMyProfileFromCore,
  isCoreCourseInScopedList,
  findScopedCoreCourseByCode,
} = await import('../../src/services/coreApiService.js');

const ok = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: () => Promise.resolve(data),
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getCourseTopicsFromCore
// ---------------------------------------------------------------------------
describe('getCourseTopicsFromCore', () => {
  it('returns topic list from Core', async () => {
    const topics = [{ id: 'cuid-t1', name: 'Intro' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ topics })));

    const result = await getCourseTopicsFromCore('cuid-course-1');

    expect(result).toEqual({ topics });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/courses/cuid-course-1/topics');
    expect(opts.headers.Authorization).toBe('Bearer test-service-key');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ error: 'COURSE_NOT_FOUND' }, 404)));

    await expect(getCourseTopicsFromCore('bad-id')).rejects.toThrow('COURSE_NOT_FOUND');
  });

  it('prefers session cookie over service key when both are available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(ok({ topics: [{ id: 'cuid-t1', name: 'Hardware' }] })),
    );

    const result = await getCourseTopicsFromCore('cuid-course-1', { cookie: 'session=abc' });

    expect(result).toEqual({ topics: [{ id: 'cuid-t1', name: 'Hardware' }] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.cookie).toBe('session=abc');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pushTopicToCore
// ---------------------------------------------------------------------------
describe('pushTopicToCore', () => {
  it('returns { id } from Core on 201', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ id: 'cuid-topic-new', name: 'Sorting' }, 201)));

    const result = await pushTopicToCore('cuid-course-1', 'Sorting');

    expect(result).toEqual({ id: 'cuid-topic-new' });
    const [, opts] = fetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ name: 'Sorting' });
  });

  it('returns { id: existingId } on 409 TOPIC_ALREADY_EXISTS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'TOPIC_ALREADY_EXISTS', existingId: 'cuid-existing' }),
      }),
    );

    const result = await pushTopicToCore('cuid-course-1', 'Sorting');

    expect(result).toEqual({ id: 'cuid-existing' });
  });

  it('throws on unexpected Core error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ error: 'COURSE_NOT_FOUND' }, 404)));

    await expect(pushTopicToCore('bad-course', 'Topic')).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// pushQuestionToCore
// ---------------------------------------------------------------------------
describe('pushQuestionToCore', () => {
  const payload = {
    courseId: 'cuid-course',
    topicId: 'cuid-topic',
    content: 'What is X?',
    type: 'MCQ',
    difficulty: 'MEDIUM',
    reasoningLevel: 'FACTUAL',
    testable: false,
    secondaryTopicIds: [],
    idempotencyKey: 'qm-variant-42',
  };

  it('returns { id } on 201', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ id: 'cuid-question' }, 201)));

    const result = await pushQuestionToCore(payload, 'session=abc');

    expect(result).toEqual({ id: 'cuid-question' });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/questions');
    expect(opts.headers.cookie).toBe('session=abc');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('throws with status + body on INVALID_TOPIC_IDS', async () => {
    const errBody = { error: 'INVALID_TOPIC_IDS', deletedTopicIds: ['cuid-t1'], conflictingWithPrimary: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(errBody, 422)));

    let caught;
    try {
      await pushQuestionToCore(payload, 'session=abc');
    } catch (err) {
      caught = err;
    }

    expect(caught.status).toBe(422);
    expect(caught.body.error).toBe('INVALID_TOPIC_IDS');
    expect(caught.body.deletedTopicIds).toEqual(['cuid-t1']);
  });

  it('throws with status + body on DUPLICATE_TOPIC', async () => {
    const errBody = { error: 'DUPLICATE_TOPIC', conflictingIds: ['cuid-t2'] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(errBody, 422)));

    await expect(pushQuestionToCore(payload, 'session=abc')).rejects.toMatchObject({
      status: 422,
      body: { error: 'DUPLICATE_TOPIC' },
    });
  });

  it('returns existing id on idempotency replay (Core returns 201 with same id)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ id: 'cuid-existing' }, 201)));

    const result = await pushQuestionToCore(payload, 'session=abc');

    expect(result.id).toBe('cuid-existing');
  });
});

// ---------------------------------------------------------------------------
// patchQuestionTestableOnCore
// ---------------------------------------------------------------------------
describe('patchQuestionTestableOnCore', () => {
  it('returns { id, testable } on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ id: 'cuid-q', testable: true })));

    const result = await patchQuestionTestableOnCore('cuid-q', true);

    expect(result).toEqual({ id: 'cuid-q', testable: true });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/questions/cuid-q');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ testable: true });
    expect(opts.headers.Authorization).toBe('Bearer test-service-key');
  });

  it('returns null on 404 QUESTION_NOT_FOUND', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ error: 'QUESTION_NOT_FOUND' }) }),
    );

    const result = await patchQuestionTestableOnCore('missing-q', false);

    expect(result).toBeNull();
  });

  it('throws on other non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ error: 'Unauthorized' }, 401)));

    await expect(patchQuestionTestableOnCore('cuid-q', true)).rejects.toMatchObject({ status: 401 });
  });
});

// ---------------------------------------------------------------------------
// RBAC read helpers (service key / cookie)
// ---------------------------------------------------------------------------
describe('getCourseEnrollmentsFromCore', () => {
  it('returns the enrollment list with the service-key header', async () => {
    const enrollments = [{ studentId: 'u1', role: 'TA', isActive: true }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ enrollments })));

    const result = await getCourseEnrollmentsFromCore('core-c1');

    expect(result).toEqual({ enrollments });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/courses/core-c1/enrollments');
    expect(opts.headers.Authorization).toBe('Bearer test-service-key');
  });

  it('returns an empty list when the course is gone (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ error: 'COURSE_NOT_FOUND' }, 404)));
    await expect(getCourseEnrollmentsFromCore('gone')).resolves.toEqual({ enrollments: [] });
  });

  it('throws on other non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ error: 'boom' }, 500)));
    await expect(getCourseEnrollmentsFromCore('c')).rejects.toMatchObject({ status: 500 });
  });
});

describe('getCourseFromCore', () => {
  it('returns the course row with the service-key header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ id: 'core-c1', department: 'COSC' })));

    const result = await getCourseFromCore('core-c1');

    expect(result).toEqual({ id: 'core-c1', department: 'COSC' });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/courses/core-c1');
    expect(opts.headers.Authorization).toBe('Bearer test-service-key');
  });

  it('returns null when the course is gone (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ error: 'COURSE_NOT_FOUND' }, 404)));
    await expect(getCourseFromCore('gone')).resolves.toBeNull();
  });
});

describe('getMyProfileFromCore', () => {
  it('forwards the caller cookie (no service key) and returns the profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ role: 'UNIT_ADMIN', authorizedUnits: ['COSC'] })));

    const result = await getMyProfileFromCore('session=abc');

    expect(result).toEqual({ role: 'UNIT_ADMIN', authorizedUnits: ['COSC'] });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/me');
    expect(opts.headers.cookie).toBe('session=abc');
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('throws on a 401 (no/invalid session)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ error: 'Unauthorized' }, 401)));
    await expect(getMyProfileFromCore('')).rejects.toMatchObject({ status: 401 });
  });
});

describe('listCoursesFromCore', () => {
  it('forwards the caller cookie (no service key) and returns scoped courses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(ok({ courses: [{ id: 'cuid-1', code: 'COSC 111' }] })),
    );

    const result = await listCoursesFromCore('session=abc');

    expect(result).toEqual({ courses: [{ id: 'cuid-1', code: 'COSC 111' }] });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/courses');
    expect(opts.headers.cookie).toBe('session=abc');
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('throws on a 401 (no/invalid session)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ error: 'Unauthorized' }, 401)));
    await expect(listCoursesFromCore('session=invalid')).rejects.toMatchObject({ status: 401 });
  });

  it('does not fall back to the service key when the session cookie is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ error: 'Forbidden' }, 403));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listCoursesFromCore('session=stale')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

describe('isCoreCourseInScopedList', () => {
  it('returns true when the course id is in the scoped list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        ok({ courses: [{ id: 'cuid-1', code: 'COSC 111' }, { id: 'cuid-2', code: 'MATH 101' }] }),
      ),
    );

    await expect(isCoreCourseInScopedList('cuid-2', 'session=abc')).resolves.toBe(true);
  });

  it('returns false when the course id is not in the scoped list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(ok({ courses: [{ id: 'cuid-1', code: 'COSC 111' }] })),
    );

    await expect(isCoreCourseInScopedList('cuid-missing', 'session=abc')).resolves.toBe(false);
  });
});

describe('findScopedCoreCourseByCode', () => {
  it('matches Core courses ignoring spaces and case', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        ok({ courses: [{ id: 'cuid-1', code: 'COSC 121' }, { id: 'cuid-2', code: 'MATH 101' }] }),
      ),
    );

    const result = await findScopedCoreCourseByCode('cosc121', 'session=abc');

    expect(result).toEqual({ id: 'cuid-1', code: 'COSC 121' });
  });

  it('returns null when no code matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(ok({ courses: [{ id: 'cuid-1', code: 'COSC 111' }] })),
    );

    await expect(findScopedCoreCourseByCode('COSC 999', 'session=abc')).resolves.toBeNull();
  });
});
