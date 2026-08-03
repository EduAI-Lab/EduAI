/**
 * Loader-level tests for the paged tree routes (#1207).
 *
 * The loaders are where the URL becomes a server query: they decide which page
 * and term get fetched, and they own the past-the-end redirect. They also carry
 * the ordinal fix — the module/lesson ordinals now come from the server rather
 * than a `findIndex` over a sibling list the loader no longer fetches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Each `describe` block dynamically imports a route module, and these routes
// pull in a large component graph — the first import in the file routinely
// costs more than the 5s default on a loaded machine. The tests themselves are
// synchronous once the module is warm.
vi.setConfig({ testTimeout: 30_000 });

const api = {
  courseById: vi.fn(),
  moduleById: vi.fn(),
  lessonById: vi.fn(),
  modulesForCourse: vi.fn(),
  lessonsForModule: vi.fn(),
  activitiesForLesson: vi.fn(),
  moduleContext: vi.fn(),
  lessonContext: vi.fn(),
};

vi.mock('~/lib/api', () => ({ default: api }));
vi.mock('~/lib/client-auth', () => ({ requireClientUser: vi.fn().mockResolvedValue({}) }));

const page = (data: unknown[], total = data.length, pageNum = 1, pageSize = 25) => ({
  data,
  total,
  page: pageNum,
  pageSize,
});

const req = (url: string) => new Request(url);

/**
 * A thrown Response's `status` is on the prototype, so `toMatchObject` can't
 * see it — assert on the caught value directly.
 */
async function expectThrownStatus(promise: Promise<unknown>, status: number) {
  try {
    await promise;
    throw new Error(`expected a thrown Response with status ${status}`);
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(status);
  }
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.courseById.mockResolvedValue({ id: 1, title: 'Course' });
  api.moduleById.mockResolvedValue({ id: 2, title: 'Module', courseOfferingId: 1 });
  api.lessonById.mockResolvedValue({ id: 3, title: 'Lesson', moduleId: 2 });
  api.modulesForCourse.mockResolvedValue(page([{ id: 10 }]));
  api.lessonsForModule.mockResolvedValue(page([{ id: 20 }]));
  api.activitiesForLesson.mockResolvedValue(page([{ id: 30 }]));
  api.moduleContext.mockResolvedValue({ moduleOrdinal: 3, moduleTotal: 9 });
  api.lessonContext.mockResolvedValue({
    moduleOrdinal: 3,
    lessonOrdinal: 2,
    moduleTotal: 9,
    lessonTotal: 4,
    prevLessonId: null,
    nextLessonId: null,
  });
});

describe('instructor.course clientLoader', () => {
  const load = async (url: string) => {
    const { clientLoader } = await import('~/routes/instructor.course');
    return clientLoader({ params: { courseId: '1' }, request: req(url) } as never);
  };

  it('passes page and search from the URL to the server', async () => {
    // Enough rows that page 2 is a real page — otherwise the loader correctly
    // redirects past the end before it can be observed.
    api.modulesForCourse.mockResolvedValue(page([{ id: 10 }], 60, 2, 25));
    await load('http://x/instructor/courses/1?page=2&search=graphs');
    expect(api.modulesForCourse).toHaveBeenCalledWith(1, { page: 2, search: 'graphs' });
  });

  it('defaults to page 1 with no term', async () => {
    await load('http://x/instructor/courses/1');
    expect(api.modulesForCourse).toHaveBeenCalledWith(1, { page: 1, search: '' });
  });

  it('returns the envelope fields the pager needs', async () => {
    api.modulesForCourse.mockResolvedValue(page([{ id: 10 }], 60, 2, 25));
    const result = await load('http://x/instructor/courses/1?page=2');
    expect(result).toMatchObject({ modulesTotal: 60, page: 2, pageSize: 25 });
  });

  it('redirects instead of rendering an empty page past the end', async () => {
    api.modulesForCourse.mockResolvedValue(page([], 60, 40, 25));
    await expectThrownStatus(load('http://x/instructor/courses/1?page=40'), 302);
  });

  it('throws a 400 Response for a non-numeric course id', async () => {
    const { clientLoader } = await import('~/routes/instructor.course');
    await expectThrownStatus(clientLoader({ params: { courseId: 'abc' }, request: req('http://x/c') } as never), 400);
  });
});

describe('instructor.module clientLoader', () => {
  const load = async (url: string) => {
    const { clientLoader } = await import('~/routes/instructor.module');
    return clientLoader({ params: { moduleId: '2' }, request: req(url) } as never);
  };

  it('passes page and search through to the lessons endpoint', async () => {
    api.lessonsForModule.mockResolvedValue(page([{ id: 20 }], 90, 3, 25));
    await load('http://x/instructor/module/2?page=3&search=dijkstra');
    expect(api.lessonsForModule).toHaveBeenCalledWith(2, { page: 3, search: 'dijkstra' });
  });

  it('takes the module ordinal from the server, not a sibling-list findIndex', async () => {
    const result = await load('http://x/instructor/module/2');
    expect(api.moduleContext).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({ moduleOrder: 3 });
    // The old implementation fetched every sibling module just to locate this
    // one; that read is what broke past the page bound.
    expect(api.modulesForCourse).not.toHaveBeenCalled();
  });

  it('redirects past the end', async () => {
    api.lessonsForModule.mockResolvedValue(page([], 10, 9, 25));
    await expectThrownStatus(load('http://x/instructor/module/2?page=9'), 302);
  });
});

describe('instructor.lesson clientLoader', () => {
  const load = async (url: string) => {
    const { clientLoader } = await import('~/routes/instructor.lesson');
    return clientLoader({ params: { lessonId: '3' }, request: req(url) } as never);
  };

  it('passes page and search through to the activities endpoint', async () => {
    api.activitiesForLesson.mockResolvedValue(page([{ id: 30 }], 60, 2, 25));
    await load('http://x/instructor/lesson/3?page=2&search=heap');
    expect(api.activitiesForLesson).toHaveBeenCalledWith(3, { page: 2, search: 'heap' });
  });

  it('builds the order text from the server context', async () => {
    const result = await load('http://x/instructor/lesson/3');
    expect(api.lessonContext).toHaveBeenCalledWith(3);
    expect(result).toMatchObject({ orderText: '3.2' });
    // Neither sibling list is fetched any more.
    expect(api.modulesForCourse).not.toHaveBeenCalled();
    expect(api.lessonsForModule).not.toHaveBeenCalled();
  });

  it('skips the context lookup for a lesson with no parent module', async () => {
    api.lessonById.mockResolvedValue({ id: 3, title: 'Orphan', moduleId: null });
    const result = await load('http://x/instructor/lesson/3');
    expect(result.orderText).toBeUndefined();
    expect(api.lessonContext).not.toHaveBeenCalled();
  });
});

describe('student.course clientLoader', () => {
  const load = async (url: string) => {
    const { clientLoader } = await import('~/routes/student.course');
    return clientLoader({ params: { courseId: '1' }, request: req(url) } as never);
  };

  it('requests the URL page rather than one bounded page', async () => {
    api.modulesForCourse.mockResolvedValue(page([{ id: 10 }], 60, 2, 25));
    await load('http://x/student/course/1?page=2');
    expect(api.modulesForCourse).toHaveBeenCalledWith(1, { page: 2 });
  });

  it('returns the total so the badge counts the course, not the page', async () => {
    api.modulesForCourse.mockResolvedValue(page([{ id: 10 }], 60, 1, 25));
    const result = await load('http://x/student/course/1');
    expect(result).toMatchObject({ modulesTotal: 60, page: 1, pageSize: 25 });
  });

  it('redirects past the end', async () => {
    api.modulesForCourse.mockResolvedValue(page([], 5, 9, 25));
    await expectThrownStatus(load('http://x/student/course/1?page=9'), 302);
  });
});

describe('student.lesson clientLoader', () => {
  const load = async () => {
    const { clientLoader } = await import('~/routes/student.lesson');
    return clientLoader({ params: { lessonId: '3' }, request: req('http://x/l/3') } as never);
  };

  it('loads a bounded first page of activities and reports the true total', async () => {
    api.activitiesForLesson.mockResolvedValue(page([{ id: 30 }], 120, 1, 50));
    const result = await load();

    expect(api.activitiesForLesson).toHaveBeenCalledWith(3, { page: 1, pageSize: 50 });
    // The player walks by index against this, appending pages as it goes.
    expect(result).toMatchObject({ activitiesTotal: 120 });
  });

  it('derives the order text from the server context', async () => {
    const result = await load();
    expect(result.orderText).toBe('3.2');
    expect(api.lessonContext).toHaveBeenCalledWith(3);
    expect(api.lessonsForModule).not.toHaveBeenCalled();
  });

  it('throws a 400 Response for a non-numeric lesson id', async () => {
    const { clientLoader } = await import('~/routes/student.lesson');
    await expectThrownStatus(clientLoader({ params: { lessonId: 'abc' }, request: req('http://x/l') } as never), 400);
  });
});
