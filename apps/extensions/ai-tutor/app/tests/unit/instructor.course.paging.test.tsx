/**
 * Route-level tests for the paged module list (#1207).
 *
 * The behaviours worth pinning: a drag on page N persists an ABSOLUTE ordinal
 * (not the page-local index), reorder is suppressed while a search is active,
 * and the pager/search box read from `total` and the URL rather than the loaded
 * page length.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor.course';

const mockMoveModule = vi.fn().mockResolvedValue({ module: {}, position: 0, total: 3 });
const mockModulesForCourse = vi
  .fn()
  .mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 });
const mockSetSearchParams = vi.fn();

vi.mock('~/lib/api', () => ({
  default: {
    courseById: vi.fn().mockResolvedValue({}),
    modulesForCourse: (...args: unknown[]) => mockModulesForCourse(...args),
    moveModuleToPosition: (...args: unknown[]) => mockMoveModule(...args),
    publishModule: vi.fn(),
    unpublishModule: vi.fn(),
  },
}));

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({
    user: { id: 'u1', name: 'Instructor', role: 'INSTRUCTOR', authorizedUnits: [] },
  }),
}));

vi.mock('~/hooks/useAtPermissions', () => ({
  useAtPermissions: () => ({ canPublishContent: true, canManageContent: true }),
}));

vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ courseId: '42' }),
    useNavigation: () => ({ state: 'idle' }),
    useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
  };
});

vi.mock('~/lib/rbac/nav', () => ({
  getCourseDetailTabs: () => [{ id: 'content', label: 'Content' }],
}));

vi.mock('~/components/layout/ShellBreadcrumbContext', () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock('~/components/layout/CourseSwitcher', () => ({ CourseSwitcher: () => null }));
vi.mock('~/hooks/useCourseTopics', () => ({
  useCourseTopics: () => ({ topics: [], total: 0, loading: false, refresh: vi.fn() }),
}));
vi.mock('~/components/courses/CourseTopicsHeroAction', () => ({
  CourseTopicsHeroAction: () => null,
}));
vi.mock('~/components/courses/CourseAnalyticsPanel', () => ({ CourseAnalyticsPanel: () => null }));
vi.mock('~/components/courses/CourseSubmissionsPanel', () => ({
  CourseSubmissionsPanel: () => null,
}));

// Expose the reorder callback so a drop can be simulated without a real
// pointer-based drag, which jsdom cannot do.
let capturedOnReorder: ((ids: number[]) => void) | null = null;
vi.mock('@eduai/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eduai/ui')>();
  return {
    ...actual,
    PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SortableProvider: ({
      children,
      onReorder,
      disabled,
    }: {
      children: React.ReactNode;
      onReorder: (ids: number[]) => void;
      disabled?: boolean;
    }) => {
      capturedOnReorder = disabled ? null : onReorder;
      return (
        <div data-testid="sortable" data-disabled={String(Boolean(disabled))}>
          {children}
        </div>
      );
    },
  };
});

import InstructorCourseModules from '~/routes/instructor.course';

const course = { id: 42, title: 'Test Course', code: 'COSC 101', isPublished: true };
const modules = [
  { id: 10, title: 'Module A', description: '', position: 0, isPublished: true },
  { id: 11, title: 'Module B', description: '', position: 1, isPublished: true },
  { id: 12, title: 'Module C', description: '', position: 2, isPublished: true },
];

function wrap(overrides: Record<string, unknown> = {}) {
  const props = {
    loaderData: {
      course,
      modules,
      modulesTotal: 60,
      page: 1,
      pageSize: 25,
      search: '',
      ...overrides,
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorCourseModules {...props} />
    </MemoryRouter>,
  );
}

describe('instructor.course — paged module list (#1207)', () => {
  beforeEach(() => {
    mockMoveModule.mockClear();
    mockModulesForCourse.mockClear();
    mockSetSearchParams.mockClear();
    capturedOnReorder = null;
  });

  it('renders the pager from the server total, not the loaded page length', () => {
    wrap();
    // 60 modules at 25 per page.
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/showing 1–25 of 60/i)).toBeInTheDocument();
  });

  it('renders a search box for the module list', () => {
    wrap();
    expect(screen.getByLabelText('Search modules')).toBeInTheDocument();
  });

  it('persists an absolute ordinal when a row is dropped on a later page', async () => {
    // Page 3, so the first slot is ordinal 50 — the whole point of the change.
    wrap({ page: 3 });

    expect(capturedOnReorder).toBeTruthy();
    await act(async () => {
      // Module C dragged to the top of the visible page.
      capturedOnReorder!([12, 10, 11]);
    });

    await waitFor(() => expect(mockMoveModule).toHaveBeenCalled());
    expect(mockMoveModule).toHaveBeenCalledWith(12, 50);
  });

  it('uses the page-local index directly on page 1', async () => {
    wrap({ page: 1 });

    await act(async () => {
      capturedOnReorder!([11, 10, 12]);
    });

    await waitFor(() => expect(mockMoveModule).toHaveBeenCalledWith(11, 0));
  });

  it('refetches the current page and term after a move, not page 1', async () => {
    wrap({ page: 2, search: '' });

    await act(async () => {
      capturedOnReorder!([11, 10, 12]);
    });

    await waitFor(() => expect(mockModulesForCourse).toHaveBeenCalled());
    expect(mockModulesForCourse).toHaveBeenCalledWith(42, { page: 2, search: '' });
  });

  it('disables reorder while a search is active', () => {
    wrap({ search: 'graphs' });

    expect(screen.getByTestId('sortable')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByText(/clear the search to reorder/i)).toBeInTheDocument();
  });

  it('tells the user their search matched nothing, distinctly from an empty course', () => {
    wrap({ modules: [], modulesTotal: 0, search: 'graphs' });
    expect(screen.getByText(/no modules match your search/i)).toBeInTheDocument();
  });

  it('shows the plain empty state when the course really has no modules', () => {
    wrap({ modules: [], modulesTotal: 0, search: '' });
    expect(screen.getByText(/no modules yet/i)).toBeInTheDocument();
  });

  it('resets to page 1 when a new search term is submitted', async () => {
    vi.useFakeTimers();
    try {
      wrap({ page: 3 });
      fireEvent.change(screen.getByLabelText('Search modules'), {
        target: { value: 'graphs' },
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(mockSetSearchParams).toHaveBeenCalled();
      const updater = mockSetSearchParams.mock.calls[0][0] as (
        prev: URLSearchParams,
      ) => URLSearchParams;
      const next = updater(new URLSearchParams('page=3'));
      expect(next.get('search')).toBe('graphs');
      // A page number from the unfiltered list is meaningless against the
      // narrowed one, and would bounce through the past-the-end redirect.
      expect(next.get('page')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
