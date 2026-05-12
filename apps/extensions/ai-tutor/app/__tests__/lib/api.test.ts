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

  it('401 response redirects to / when not already at /', async () => {
    window.location.pathname = '/dashboard';
    window.location.href = '/dashboard';

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const { api } = await import('~/lib/api');

    await expect(api.listCourses()).rejects.toThrow('Authentication required');
    expect(window.location.href).toBe('/');
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

  it('all expected API methods exist', async () => {
    const { api } = await import('~/lib/api');

    const expectedMethods = [
      'me',
      'listCourses',
      'courseById',
      'createCourse',
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

  it('api.logout calls the sign-out endpoint with POST and credentials', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const { api } = await import('~/lib/api');
    const result = await api.logout();

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/auth/sign-out');
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('include');
    expect(result).toEqual({ ok: true });
  });
});
