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
      'updateCourse',
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
});
