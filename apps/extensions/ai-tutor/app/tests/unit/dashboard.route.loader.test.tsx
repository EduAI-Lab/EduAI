/**
 * #1208: the dashboard keeps the course `total` alongside its bounded page so
 * the Continue-Learning / Needs-Attention panels can disclose the truncation
 * instead of implying the preview is the whole list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listCourses = vi.fn();
const mySubmissions = vi.fn();
const listAdminUsers = vi.fn();
const listAdminBugReports = vi.fn();
const dashboardStats = vi.fn();

vi.mock('~/lib/api', () => {
  const api = {
    listCourses: (...a: unknown[]) => listCourses(...a),
    mySubmissions: (...a: unknown[]) => mySubmissions(...a),
    listAdminUsers: (...a: unknown[]) => listAdminUsers(...a),
    listAdminBugReports: (...a: unknown[]) => listAdminBugReports(...a),
    dashboardStats: (...a: unknown[]) => dashboardStats(...a),
  };
  return { default: api, api };
});

const requireClientUser = vi.fn();
vi.mock('~/lib/client-auth', () => ({
  requireClientUser: (...a: unknown[]) => requireClientUser(...a),
}));

import { clientLoader } from '~/routes/dashboard';
import type { Route } from '../../routes/+types/dashboard';

const runLoader = () => clientLoader({} as Route.ClientLoaderArgs);

describe('dashboard clientLoader (#1208)', () => {
  beforeEach(() => {
    requireClientUser.mockReset().mockResolvedValue({ id: 'u1', name: 'Prof', role: 'INSTRUCTOR' });
    listCourses.mockReset().mockResolvedValue({
      data: [{ id: 1, title: 'Linear Algebra' }],
      total: 4312,
      page: 1,
      pageSize: 200,
    });
    mySubmissions.mockReset().mockResolvedValue([]);
    listAdminUsers.mockReset().mockResolvedValue(null);
    listAdminBugReports.mockReset().mockResolvedValue([]);
    dashboardStats.mockReset().mockResolvedValue(null);
  });

  it('returns the page alongside the full course total', async () => {
    const data = await runLoader();

    expect(data.courses).toHaveLength(1);
    // Without this the panels can't tell they're showing a slice.
    expect(data.courseTotal).toBe(4312);
  });

  it('still resolves when the stats rollup fails', async () => {
    dashboardStats.mockRejectedValue(new Error('not rolled out'));

    const data = await runLoader();

    expect(data.dashboardStats).toBeNull();
    expect(data.courseTotal).toBe(4312);
  });

  it('skips submissions for a non-learner role', async () => {
    await runLoader();

    expect(mySubmissions).not.toHaveBeenCalled();
  });

  it('loads submissions for a student', async () => {
    requireClientUser.mockResolvedValue({ id: 'u2', name: 'Stu', role: 'STUDENT' });

    const data = await runLoader();

    expect(mySubmissions).toHaveBeenCalled();
    expect(data.role).toBe('STUDENT');
  });

  it('loads the admin-only extras for an admin', async () => {
    requireClientUser.mockResolvedValue({ id: 'u3', name: 'Admin', role: 'ADMIN' });
    listAdminUsers.mockResolvedValue({ data: [], total: 12, page: 1, pageSize: 1 });

    const data = await runLoader();

    expect(listAdminUsers).toHaveBeenCalledWith({ pageSize: 1 });
    expect(data.adminUsers).toMatchObject({ total: 12 });
  });
});
