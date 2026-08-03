/**
 * #1208: the student loader threads search / term / progress to the server and
 * gained the page guard the instructor list already had.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listCourses = vi.fn();
const listCourseFacets = vi.fn();

vi.mock('~/lib/api', () => {
  const api = {
    listCourses: (...a: unknown[]) => listCourses(...a),
    listCourseFacets: (...a: unknown[]) => listCourseFacets(...a),
  };
  return { default: api, api };
});

vi.mock('~/lib/client-auth', () => ({
  requireClientUser: vi.fn().mockResolvedValue({ id: 'u1', name: 'Student', role: 'STUDENT' }),
}));

import { clientLoader } from '~/routes/student';
import type { Route } from '../../routes/+types/student';

const runLoader = (url: string) =>
  clientLoader({ request: new Request(url) } as Route.ClientLoaderArgs);

describe('student clientLoader (#1208)', () => {
  beforeEach(() => {
    listCourses.mockReset().mockResolvedValue({
      data: [{ id: 1, title: 'Linear Algebra' }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    listCourseFacets.mockReset().mockResolvedValue({
      terms: ['W1::2026'],
      statuses: ['published'],
      progress: ['not-started', 'in-progress', 'completed'],
    });
  });

  it('sends no filters for a bare URL', async () => {
    await runLoader('http://x/student');

    expect(listCourses).toHaveBeenCalledWith({
      page: 1,
      search: undefined,
      term: [],
      progress: [],
    });
  });

  it('threads search, term and progress through to the server', async () => {
    listCourses.mockResolvedValue({ data: [], total: 400, page: 2, pageSize: 200 });

    await runLoader('http://x/student?search=algebra&term=W1::2026&progress=completed&page=2');

    expect(listCourses).toHaveBeenCalledWith({
      page: 2,
      search: 'algebra',
      term: ['W1::2026'],
      progress: ['completed'],
    });
  });

  it('does not send a status filter — students only ever see published courses', async () => {
    await runLoader('http://x/student?status=draft');

    expect(listCourses).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });

  it('fetches facets alongside the page', async () => {
    const data = await runLoader('http://x/student');

    expect(listCourseFacets).toHaveBeenCalledTimes(1);
    expect(data.facets.progress).toEqual(['not-started', 'in-progress', 'completed']);
  });

  it('returns the paging fields the new pager needs', async () => {
    listCourses.mockResolvedValue({ data: [], total: 450, page: 1, pageSize: 200 });

    const data = await runLoader('http://x/student');

    expect(data).toMatchObject({ total: 450, page: 1, pageSize: 200 });
  });

  it('redirects a past-the-end page while preserving the filters', async () => {
    listCourses.mockResolvedValue({ data: [], total: 1, page: 9, pageSize: 200 });

    const thrown = await runLoader('http://x/student?page=9&search=algebra&progress=completed').catch(
      (e: Response) => e,
    );

    expect((thrown as Response).status).toBe(302);
    const location = (thrown as Response).headers.get('Location') ?? '';
    expect(location).toContain('page=1');
    expect(location).toContain('search=algebra');
    expect(location).toContain('progress=completed');
  });
});
