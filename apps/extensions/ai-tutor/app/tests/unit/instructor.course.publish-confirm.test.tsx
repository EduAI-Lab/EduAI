import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor.course';

const mockPublishModule = vi.fn().mockResolvedValue({ id: 10, title: 'Module 1', isPublished: true });
const mockUnpublishModule = vi.fn().mockResolvedValue({ id: 10, title: 'Module 1', isPublished: false });

vi.mock('~/lib/api', () => ({
  default: {
    courseById: vi.fn().mockResolvedValue({}),
    modulesForCourse: vi.fn().mockResolvedValue([]),
    publishModule: (...args: unknown[]) => mockPublishModule(...args),
    unpublishModule: (...args: unknown[]) => mockUnpublishModule(...args),
  },
}));

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: { id: 'u1', name: 'Instructor', role: 'INSTRUCTOR', authorizedUnits: [] } }),
}));

vi.mock('~/hooks/useAtPermissions', () => ({
  useAtPermissions: () => ({ canPublishContent: true }),
}));

vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ courseId: '42' }),
  };
});

vi.mock('~/lib/rbac/nav', () => ({
  getCourseDetailTabs: () => [{ id: 'content', label: 'Content' }],
}));

vi.mock('~/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/components/layout/ShellBreadcrumbs', () => ({
  ShellBreadcrumbs: () => null,
}));

vi.mock('~/components/rbac/PermissionGate', () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/components/courses/CourseAnalyticsPanel', () => ({ CourseAnalyticsPanel: () => null }));
vi.mock('~/components/courses/CourseEnrollmentsPanel', () => ({ CourseEnrollmentsPanel: () => null }));
vi.mock('~/components/courses/CourseStudentMetricsPanel', () => ({ CourseStudentMetricsPanel: () => null }));
vi.mock('~/components/courses/CourseSubmissionsPanel', () => ({ CourseSubmissionsPanel: () => null }));

import InstructorCourseModules from '~/routes/instructor.course';

const course = { id: 42, title: 'Test Course', isPublished: true };
const module_ = { id: 10, title: 'Module 1', isPublished: false };

function wrap(modules = [module_]) {
  const props = { loaderData: { course, modules } } as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorCourseModules {...props} />
    </MemoryRouter>,
  );
}

describe('instructor.course — publish/unpublish module confirmation dialog', () => {
  beforeEach(() => {
    mockPublishModule.mockClear();
    mockUnpublishModule.mockClear();
  });

  it('clicking the module publish button opens the dialog without calling the API', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(mockPublishModule).not.toHaveBeenCalled();
    expect(mockUnpublishModule).not.toHaveBeenCalled();
  });

  it('confirming calls publishModule with the module id', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    });

    expect(mockPublishModule).toHaveBeenCalledWith(module_.id);
  });

  it('cancelling does not call the API', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    expect(mockPublishModule).not.toHaveBeenCalled();
    expect(mockUnpublishModule).not.toHaveBeenCalled();
  });

  it('confirming unpublish calls unpublishModule', async () => {
    wrap([{ ...module_, isPublished: true }]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^published$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublish$/i }));
    });

    expect(mockUnpublishModule).toHaveBeenCalledWith(module_.id);
  });
});
