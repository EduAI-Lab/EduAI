// We need to set up mocks BEFORE importing the module under test.
// The api module reads import.meta.env.VITE_API_URL at module level.

const mockFetch = vi.fn();

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();

  // Reset window.location before each test
  Object.defineProperty(window, 'location', {
    value: { pathname: '/dashboard', href: '' },
    writable: true,
    configurable: true,
  });
});

describe('API_BASE', () => {
  it('defaults to http://localhost:4000 when VITE_API_URL is not set', async () => {
    const { API_BASE } = await import('~/lib/api');
    expect(API_BASE).toBe('http://localhost:4000');
  });
});

describe('api methods', () => {
  it('api.me() calls fetch with correct URL and credentials: include', async () => {
    const mockResponse = {
      user: { id: '1', name: 'Test', email: 'test@example.com', role: 'STUDENT' },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const { api } = await import('~/lib/api');
    const result = await api.me();

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/me');
    expect(options.credentials).toBe('include');
    expect(result).toEqual(mockResponse);
  });

  // #1162: the server parses /api/courses in required mode, so a call that
  // supplied only pageSize used to 400 with PAGINATION_REQUIRED on every
  // non-pager surface (dashboards, course switcher, command palette, imports).
  describe('course-list pagination query strings', () => {
    const okEmptyPage = () =>
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [], total: 0, page: 1, pageSize: 200 }),
      });

    it('listCourses() sends both page and pageSize by default', async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import('~/lib/api');
      await api.listCourses();

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/courses?page=1&pageSize=${COURSE_LIST_PAGE_SIZE}`,
      );
    });

    it('listAdminCourses() sends both page and pageSize by default', async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import('~/lib/api');
      await api.listAdminCourses();

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/admin/courses?page=1&pageSize=${COURSE_LIST_PAGE_SIZE}`,
      );
    });

    it('an explicit page overrides the default without dropping pageSize', async () => {
      okEmptyPage();
      const { api, COURSE_LIST_PAGE_SIZE } = await import('~/lib/api');
      await api.listCourses({ page: 3 });

      expect(mockFetch.mock.calls[0][0]).toBe(
        `http://localhost:4000/api/courses?page=3&pageSize=${COURSE_LIST_PAGE_SIZE}`,
      );
    });

    it('an explicit pageSize overrides the default without dropping page', async () => {
      okEmptyPage();
      const { api } = await import('~/lib/api');
      await api.listCourses({ page: 2, pageSize: 25 });

      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://localhost:4000/api/courses?page=2&pageSize=25',
      );
    });

    it('tree endpoints also send a complete pair', async () => {
      okEmptyPage();
      const { api } = await import('~/lib/api');
      await api.modulesForCourse(7);

      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://localhost:4000/api/courses/7/modules?page=1&pageSize=200',
      );
    });
  });

  it('successful response returns parsed JSON', async () => {
    const mockData = { courses: [{ id: 1, title: 'Math 101' }] };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockData),
    });

    const { api } = await import('~/lib/api');
    const result = await api.listCourses();

    expect(result).toEqual(mockData);
  });

  it('401 response redirects to Core login with force=1 and a ?redirect= param', async () => {
    window.location.pathname = '/dashboard';
    window.location.href = 'http://localhost:3001/dashboard';

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const { api } = await import('~/lib/api');

    await expect(api.listCourses()).rejects.toThrow('Authentication required');
    expect(window.location.href).toMatch(
      /^http:\/\/localhost:3000\/login\?force=1&redirect=/,
    );
  });

  it('403 response throws without redirecting to login (no infinite loop)', async () => {
    window.location.pathname = '/instructor/lesson/3';
    window.location.href = 'http://localhost:3001/instructor/lesson/3';

    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Not authorized for this lesson'),
    });

    const { api } = await import('~/lib/api');

    await expect(api.lessonById(3)).rejects.toThrow('Not authorized for this lesson');
    // An authenticated-but-forbidden caller must NOT be bounced to Core login
    // (doing so would loop straight back to the same 403).
    expect(window.location.href).toBe('http://localhost:3001/instructor/lesson/3');
  });

  it('500 response throws with error text', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal server error'),
    });

    const { api } = await import('~/lib/api');

    await expect(api.listCourses()).rejects.toThrow('Internal server error');
  });

  it('a fetch-level failure (e.g. API not listening yet) throws ApiNetworkError without redirecting', async () => {
    window.location.pathname = '/dashboard';
    window.location.href = 'http://localhost:3001/dashboard';

    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const { api, ApiNetworkError } = await import('~/lib/api');

    await expect(api.me()).rejects.toThrow(ApiNetworkError);
    // Unlike a 401, a connection failure must not bounce the user to login —
    // the caller decides whether to retry.
    expect(window.location.href).toBe('http://localhost:3001/dashboard');
  });

  it('all expected API methods exist', async () => {
    const { api } = await import('~/lib/api');

    const expectedMethods = [
      'me',
      'listCourses',
      'courseById',
      'modulesForCourse',
      'moduleById',
      'createModule',
      'lessonsForModule',
      'createLesson',
      'lessonById',
      'activitiesForLesson',
      'createActivity',
      'updateActivity',
      'deleteActivity',
      'topicsForCourse',
      'createTopic',
      'submitAnswer',
      'listPrompts',
      'createPrompt',
      'logout',
    ];

    for (const method of expectedMethods) {
      expect(typeof (api as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('a caller-aborted request rejects with the AbortError as-is (Stop button, #999)', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
        }),
    );

    const { api } = await import('~/lib/api');
    const pending = api.sendGuideMessage(
      1,
      { knowledgeLevel: 'beginner', message: 'hi', modelId: 'm', apiKey: 'k' },
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a chat send method\'s opt-in client-side timeout rejects with ApiTimeoutError, distinct from a caller abort', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const { api, ApiTimeoutError } = await import('~/lib/api');
    const pending = api.sendGuideMessage(1, {
      knowledgeLevel: 'beginner',
      message: 'hi',
      modelId: 'm',
      apiKey: 'k',
    });
    const assertion = expect(pending).rejects.toThrow(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    vi.useRealTimers();
  });

  it('a 504 response (server-side EDUAI_CALL_TIMEOUT_MS bound) maps to ApiTimeoutError', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 504,
      text: () => Promise.resolve('{"error":"The AI study buddy took too long to respond. Please try again."}'),
    });

    const { api, ApiTimeoutError } = await import('~/lib/api');

    await expect(
      api.sendGuideMessage(1, { knowledgeLevel: 'beginner', message: 'hi', modelId: 'm', apiKey: 'k' }),
    ).rejects.toThrow(ApiTimeoutError);
  });

  it('http() applies no timeout unless a caller opts in via timeoutMs (#999 review scope)', async () => {
    vi.useFakeTimers();
    // A call that never resolves and is never aborted — if a global timeout
    // existed, this would reject once fake time advances past it.
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { api } = await import('~/lib/api');
    const pending = api.listCourses();
    let settled = false;
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);
    vi.useRealTimers();
  });

  it('api.logout proxies sign-out through the AT backend with POST and credentials', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const { api } = await import('~/lib/api');
    const result = await api.logout();

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/logout');
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('include');
    expect(result).toEqual({ ok: true });
  });

  // #1041: Core's user list is server-paginated, so these two calls always send
  // paging params and the admin views read the envelope (and its `stats`) rather
  // than counting an array.
  it('api.listAdminUsers() defaults to the first page and returns the envelope', async () => {
    const page = {
      data: [{ id: 'u1', name: 'Student', role: 'STUDENT' }],
      total: 137,
      page: 1,
      pageSize: 25,
      stats: { total: 137, active: 130, byRole: { STUDENT: 120 } },
    };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(page) });

    const { api } = await import('~/lib/api');
    const result = await api.listAdminUsers();

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/admin/users?page=1&pageSize=25');
    expect(options.credentials).toBe('include');
    // `stats` carries the platform-wide totals the dashboard needs.
    expect(result).toEqual(page);
  });

  it('api.listAdminUsers() forwards an explicit page and pageSize', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [], total: 0, page: 4, pageSize: 100 }),
    });

    const { api } = await import('~/lib/api');
    await api.listAdminUsers({ page: 4, pageSize: 100 });

    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/admin/users?page=4&pageSize=100',
    );
  });

  it('api.getAdminCourseEnrollments() omits the query string when unfiltered', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ enrollments: [], availableStudents: [] }),
    });

    const { api } = await import('~/lib/api');
    await api.getAdminCourseEnrollments(9);

    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/admin/courses/9/enrollments',
    );
  });

  it('api.getAdminCourseEnrollments() sends search/page/pageSize so students past page 1 stay reachable', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          enrollments: [],
          availableStudents: [{ id: 'u9' }],
          availableStudentsPage: { total: 900, page: 2, pageSize: 50 },
        }),
    });

    const { api } = await import('~/lib/api');
    const result = await api.getAdminCourseEnrollments(9, {
      search: 'ali',
      page: 2,
      pageSize: 50,
    });

    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/admin/courses/9/enrollments?search=ali&page=2&pageSize=50',
    );
    expect(result.availableStudentsPage.total).toBe(900);
  });

  it('api.getAdminCourseEnrollments() drops an empty search rather than sending search=', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ enrollments: [], availableStudents: [] }),
    });

    const { api } = await import('~/lib/api');
    await api.getAdminCourseEnrollments(9, { search: '', page: 3 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain('search=');
    expect(url).toContain('page=3');
  });

  it('api.listCourseFeedback() builds query params for course feedback (#784)', async () => {
    const mockData = [{ id: 1, userId: 's1', activityId: 2, rating: 5, createdAt: '2026-07-01' }];
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockData),
    });

    const { api } = await import('~/lib/api');
    const result = await api.listCourseFeedback(9, {
      activityId: 2,
      studentId: 's1',
      take: 100,
      skip: 50,
    });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'http://localhost:4000/api/courses/9/feedback?activityId=2&studentId=s1&take=100&skip=50',
    );
    expect(options.credentials).toBe('include');
    expect(result).toEqual(mockData);
  });
});
