/**
 * Tests for the activity import picker's server-side search (#1207).
 *
 * `/api/activities/importable` is scoped to every course the caller manages, so
 * one page of it is a slice of their whole activity corpus. The picker must
 * send the term to the server (never filter the page it holds) and say so when
 * more matches exist than it is showing.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor.lesson';

const mockListImportable = vi.fn();
const mockMoveActivity = vi.fn().mockResolvedValue({ activity: {}, position: 0, total: 60 });

vi.mock('~/lib/api', () => ({
  default: {
    lessonById: vi.fn().mockResolvedValue({ id: 1, title: 'Lesson 1', moduleId: null }),
    activitiesForLesson: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 }),
    listImportableActivities: (...args: unknown[]) => mockListImportable(...args),
    moveActivityToPosition: (...args: unknown[]) => mockMoveActivity(...args),
    importActivity: vi.fn().mockResolvedValue({}),
    deleteActivity: vi.fn(),
    syncTopics: vi.fn().mockResolvedValue({ missingTopics: 0 }),
  },
}));

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({
    user: { id: 'u1', name: 'Instructor', role: 'INSTRUCTOR', authorizedUnits: [] },
  }),
}));

vi.mock('~/hooks/useAtPermissions', () => ({
  useAtPermissions: () => ({ canManageContent: true, canPublishContent: true }),
}));

vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ lessonId: '1' }),
    useNavigation: () => ({ state: 'idle' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('~/hooks/useCourseTopics', () => ({
  CourseTopicsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCourseTopics: () => ({ topics: [], total: 0, loading: false }),
}));
vi.mock('~/components/layout/ShellBreadcrumbContext', () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock('~/components/layout/CourseSwitcher', () => ({ CourseSwitcher: () => null }));
// Everything stays real except PermissionGate and SortableProvider — the
// picker tests need the actual Dialog/Combobox, while the reorder test needs a
// handle on the drop callback (jsdom cannot perform a pointer drag).
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
      return <div data-testid="sortable" data-disabled={String(Boolean(disabled))}>{children}</div>;
    },
  };
});
vi.mock('~/components/AddActivityPanel', () => ({ default: () => null }));
vi.mock('~/components/EditActivityPanel', () => ({ default: () => null }));
vi.mock('~/components/ActivityDetailsCard', () => ({ default: () => null }));
vi.mock('~/components/AddCourseTopicsButton', () => ({ default: () => null }));
vi.mock('~/components/bug-report/useBugReport', () => ({
  useBugReport: () => ({ setContext: vi.fn(), clearContext: vi.fn() }),
}));
vi.mock('~/components/TourButton', () => ({ default: () => null }));

import InstructorLessonBuilder from '~/routes/instructor.lesson';

const course = { id: 1, title: 'Course 1', code: 'COSC 101', isPublished: true };
const module_ = {
  id: 1,
  title: 'Module 1',
  description: '',
  position: 0,
  courseOfferingId: 1,
  lessons: [],
};
const lesson = { id: 1, title: 'Lesson 1', moduleId: 1, isPublished: true, contentMd: '', courseOfferingId: 1 };

const candidate = (id: number, title: string) => ({
  id,
  title,
  type: 'SHORT_TEXT',
  lessonId: 9,
  lessonTitle: 'Week 9',
  moduleTitle: 'Module 3',
});

function wrap() {
  const props = {
    loaderData: {
      course,
      module: module_,
      lesson,
      activities: [],
      activitiesTotal: 0,
      orderText: '1.1',
      page: 1,
      pageSize: 25,
      search: '',
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorLessonBuilder {...props} />
    </MemoryRouter>,
  );
}

/** Open the import dialog and settle the initial unfiltered fetch. */
async function openPicker() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));
  });
  await waitFor(() => expect(mockListImportable).toHaveBeenCalled());
}

describe('instructor.lesson — activity import picker (#1207)', () => {
  beforeEach(() => {
    mockListImportable.mockReset();
    mockListImportable.mockResolvedValue({
      data: [candidate(1, 'Heap insertion')],
      total: 1,
      page: 1,
      pageSize: 25,
    });
  });

  it('fetches an unfiltered first page when the dialog opens', async () => {
    wrap();
    await openPicker();

    expect(mockListImportable).toHaveBeenCalledWith(1, {
      excludeLessonId: 1,
      search: '',
    });
  });

  it('sends a typed term to the server after the debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wrap();
      await openPicker();

      await act(async () => {
        fireEvent.click(screen.getByRole('combobox'));
      });
      fireEvent.change(screen.getByPlaceholderText(/search all your activities/i), {
        target: { value: 'quicksort' },
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() =>
        expect(mockListImportable).toHaveBeenLastCalledWith(1, {
          excludeLessonId: 1,
          search: 'quicksort',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('warns that matches are being withheld when total exceeds the page', async () => {
    mockListImportable.mockResolvedValue({
      data: [candidate(1, 'Heap insertion')],
      total: 812,
      page: 1,
      pageSize: 25,
    });
    wrap();
    await openPicker();

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox'));
    });

    expect(screen.getByText(/showing 1 of 812 matches/i)).toBeInTheDocument();
  });

  it('shows no truncation note when the page holds every match', async () => {
    wrap();
    await openPicker();

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox'));
    });

    expect(screen.queryByText(/keep typing to narrow/i)).not.toBeInTheDocument();
  });

  it('surfaces a retry affordance when the fetch fails', async () => {
    mockListImportable.mockRejectedValue(new Error('network'));
    wrap();
    await openPicker();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument(),
    );
  });
});

/**
 * The activity list's own paging + reorder path (#1207). Same contract as the
 * module and lesson grids: a drop persists an absolute ordinal, and the pager
 * is driven by the server total.
 */
describe('instructor.lesson — paged activity list (#1207)', () => {
  const activity = (id: number) => ({
    id,
    title: `Activity ${id}`,
    instructionsMd: '',
    position: id,
    question: `Q${id}`,
    type: 'SHORT_TEXT' as const,
    options: null,
    hints: [],
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: false,
    enableCustomMode: false,
    customPrompt: null,
    customPromptTitle: null,
  });

  const wrapList = (overrides: Record<string, unknown> = {}) => {
    const props = {
      loaderData: {
        course,
        module: module_,
        lesson,
        activities: [activity(1), activity(2), activity(3)],
        activitiesTotal: 60,
        orderText: '1.1',
        page: 1,
        pageSize: 25,
        search: '',
        ...overrides,
      },
    } as unknown as Route.ComponentProps;
    return render(
      <MemoryRouter>
        <InstructorLessonBuilder {...props} />
      </MemoryRouter>,
    );
  };

  it('renders a pager from the server total', () => {
    wrapList();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
  });

  it('renders a search box for the activity list', () => {
    wrapList();
    expect(screen.getByLabelText('Search activities')).toBeInTheDocument();
  });

  it('numbers rows by absolute ordinal so page 2 does not restart at 01', () => {
    wrapList({ page: 2 });
    // First row on page 2 is the 26th activity.
    expect(screen.getAllByText('26').length).toBeGreaterThan(0);
  });

  it('offers a move-to-position affordance for cross-page moves', () => {
    wrapList();
    expect(screen.getAllByLabelText('Move activity to position').length).toBeGreaterThan(0);
  });

  it('hides the move affordance while a search is active', () => {
    wrapList({ search: 'heap' });
    expect(screen.queryByLabelText('Move activity to position')).not.toBeInTheDocument();
    expect(screen.getByText(/clear the search to reorder/i)).toBeInTheDocument();
  });

  it('distinguishes an empty search result from an empty lesson', () => {
    wrapList({ activities: [], activitiesTotal: 0, search: 'heap' });
    expect(screen.getByText(/no activities match your search/i)).toBeInTheDocument();
  });
});

describe('instructor.lesson — activity drag persists an absolute ordinal (#1207)', () => {
  const dragActivity = (id: number) => ({
    id,
    title: `Activity ${id}`,
    instructionsMd: '',
    position: id,
    question: `Q${id}`,
    type: 'SHORT_TEXT' as const,
    options: null,
    hints: [],
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: false,
    enableCustomMode: false,
    customPrompt: null,
    customPromptTitle: null,
  });

  const wrapList = (overrides: Record<string, unknown> = {}) => {
    const props = {
      loaderData: {
        course,
        module: module_,
        lesson,
        activities: [dragActivity(1), dragActivity(2), dragActivity(3)],
        activitiesTotal: 60,
        orderText: '1.1',
        page: 1,
        pageSize: 25,
        search: '',
        ...overrides,
      },
    } as unknown as Route.ComponentProps;
    return render(
      <MemoryRouter>
        <InstructorLessonBuilder {...props} />
      </MemoryRouter>,
    );
  };

  beforeEach(() => {
    mockMoveActivity.mockClear();
    capturedOnReorder = null;
  });

  it('offsets the drop index by the pages before it', async () => {
    wrapList({ page: 3 });

    expect(capturedOnReorder).toBeTruthy();
    await act(async () => {
      capturedOnReorder!([3, 1, 2]);
    });

    // Page 3, first visible slot → ordinal 50.
    await waitFor(() => expect(mockMoveActivity).toHaveBeenCalledWith(3, 50));
  });

  it('ignores a drop that did not actually change the order', async () => {
    wrapList();

    await act(async () => {
      capturedOnReorder!([1, 2, 3]);
    });

    expect(mockMoveActivity).not.toHaveBeenCalled();
  });

  it('disables dragging entirely while a search is active', () => {
    wrapList({ search: 'heap' });
    expect(screen.getByTestId('sortable')).toHaveAttribute('data-disabled', 'true');
  });
});
