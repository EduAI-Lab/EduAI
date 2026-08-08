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
    // #1207: these routes now drive a URL-backed pager + search box.
    useNavigation: () => ({ state: 'idle' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useParams: () => ({ courseId: '42' }),
  };
});

vi.mock('~/lib/rbac/nav', () => ({
  getCourseDetailTabs: () => [{ id: 'content', label: 'Content' }],
}));

// Redesign: the course page composes the shared shell via the layout route and
// publishes its breadcrumb trail through the shell context; it also hosts a
// course switcher and topic hero action. Stub those so the render is isolated.
vi.mock('~/components/layout/ShellBreadcrumbContext', () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock('~/components/layout/CourseSwitcher', () => ({ CourseSwitcher: () => null }));
vi.mock('~/hooks/useCourseTopics', () => ({
  useCourseTopics: () => ({ topics: [], loading: false, refresh: vi.fn() }),
}));
vi.mock('~/components/courses/CourseTopicsHeroAction', () => ({ CourseTopicsHeroAction: () => null }));

// PermissionGate now ships from @eduai/ui — partial-mock so the other primitives
// this route imports keep their real implementations.
vi.mock('@eduai/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eduai/ui')>()),
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/components/courses/CourseAnalyticsPanel', () => ({ CourseAnalyticsPanel: () => null }));
vi.mock('~/components/courses/CourseSubmissionsPanel', () => ({ CourseSubmissionsPanel: () => null }));

// The redesign moved module actions into a PublishMenu kebab (Radix dropdown).
// This test targets the ported #742 confirmation flow, not the menu mechanics,
// so PublishMenu is reduced to the status button that fires onToggle.
vi.mock('~/components/PublishMenu', () => ({
  PublishMenu: ({ isPublished, onToggle }: { isPublished: boolean; onToggle?: () => void }) => (
    <button type="button" onClick={() => onToggle?.()}>
      {isPublished ? 'Published' : 'Unpublished'}
    </button>
  ),
}));

import InstructorCourseModules from '~/routes/instructor.course';

const course = { id: 42, title: 'Test Course', code: 'COSC 101', isPublished: true };
const module_ = { id: 10, title: 'Module 1', description: '', position: 0, isPublished: false };

function wrap(modules = [module_]) {
  const props = { loaderData: { course, modules, modulesTotal: modules.length, page: 1, pageSize: 25, search: '' } } as unknown as Route.ComponentProps;
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
