import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor';

const mockPublishCourse = vi.fn().mockResolvedValue({ id: 1, title: 'Test Course', isPublished: true });
const mockUnpublishCourse = vi.fn().mockResolvedValue({ id: 1, title: 'Test Course', isPublished: false });

vi.mock('~/lib/api', () => ({
  default: {
    listCourses: vi.fn().mockResolvedValue([]),
    publishCourse: (...args: unknown[]) => mockPublishCourse(...args),
    unpublishCourse: (...args: unknown[]) => mockUnpublishCourse(...args),
  },
}));

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: { id: 'u1', name: 'Instructor', role: 'INSTRUCTOR' } }),
}));

vi.mock('~/hooks/useAtPermissions', () => ({
  useAtPermissions: () => ({ canPublishContent: true }),
}));

vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('~/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/components/layout/ShellBreadcrumbs', () => ({
  ShellBreadcrumbs: () => null,
}));

vi.mock('~/components/dashboard/RoleDashboard', () => ({
  RoleDashboard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/components/rbac/AtRoleBanner', () => ({ AtRoleBanner: () => null }));
vi.mock('~/components/rbac/PermissionGate', () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/lib/extension-urls', () => ({
  getEduAiAppUrl: () => 'http://localhost:3000',
}));

import InstructorHome from '~/routes/instructor';

const course = { id: 1, title: 'Test Course', isPublished: false };

function wrap(courses = [course]) {
  const props = { loaderData: { courses } } as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorHome {...props} />
    </MemoryRouter>,
  );
}

describe('instructor — publish/unpublish confirmation dialog', () => {
  beforeEach(() => {
    mockPublishCourse.mockClear();
    mockUnpublishCourse.mockClear();
  });

  it('clicking Unpublished opens the dialog without calling the API', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(mockPublishCourse).not.toHaveBeenCalled();
    expect(mockUnpublishCourse).not.toHaveBeenCalled();
  });

  it('confirming calls publishCourse with the course id', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    });

    expect(mockPublishCourse).toHaveBeenCalledWith(course.id);
  });

  it('cancelling does not call the API', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    expect(mockPublishCourse).not.toHaveBeenCalled();
    expect(mockUnpublishCourse).not.toHaveBeenCalled();
  });

  it('clicking Published opens the unpublish dialog without calling the API', async () => {
    wrap([{ ...course, isPublished: true }]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^published$/i }));
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(mockUnpublishCourse).not.toHaveBeenCalled();
  });

  it('confirming unpublish calls unpublishCourse', async () => {
    wrap([{ ...course, isPublished: true }]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^published$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublish$/i }));
    });

    expect(mockUnpublishCourse).toHaveBeenCalledWith(course.id);
  });
});
