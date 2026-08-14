/**
 * Duplicate-activity placement on a paged list (#1207).
 *
 * The server appends the clone after the LAST activity in the lesson, not after
 * the row it was cloned from. Splicing it into whatever page happens to be on
 * screen renders a 26th row on a 25-row page and shifts every drag ordinal
 * below it out of sync with the server's real order, so the duplicate has to
 * reveal the last page instead.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor.lesson';

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: vi.fn() } }));

const mockDuplicateActivity = vi.fn();
const mockActivitiesForLesson = vi.fn();
const mockSetSearchParams = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('~/lib/api', () => ({
  default: {
    lessonById: vi.fn().mockResolvedValue({ id: 1, title: 'Lesson 1', moduleId: null }),
    activitiesForLesson: (...args: unknown[]) => mockActivitiesForLesson(...args),
    duplicateActivity: (...args: unknown[]) => mockDuplicateActivity(...args),
    deleteActivity: vi.fn().mockResolvedValue(undefined),
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
    useSearchParams: () => [currentSearchParams, mockSetSearchParams],
  };
});

vi.mock('~/hooks/useCourseTopics', () => ({
  CourseTopicsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCourseTopics: () => ({ topics: [], loading: false }),
}));

vi.mock('~/components/layout/ShellBreadcrumbContext', () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));

vi.mock('@eduai/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eduai/ui')>()),
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/components/AddActivityPanel', () => ({ default: () => null }));
vi.mock('~/components/EditActivityPanel', () => ({ default: () => null }));
vi.mock('~/components/ActivityDetailsCard', () => ({ default: () => null }));
vi.mock('~/components/AddCourseTopicsButton', () => ({ default: () => null }));
vi.mock('~/components/bug-report/useBugReport', () => ({
  useBugReport: () => ({ setBugContext: vi.fn() }),
}));
vi.mock('~/components/TourButton', () => ({ default: () => null }));
vi.mock('~/components/TourProvider', () => ({
  TourProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAppTour: () => ({}),
}));

import InstructorLessonBuilder from '~/routes/instructor.lesson';

const course = { id: 1, title: 'Course 1', code: 'COSC 101', isPublished: true };
const module = {
  id: 1,
  title: 'Module 1',
  description: '',
  position: 0,
  courseOfferingId: 1,
  lessons: [],
};
const lesson = { id: 1, title: 'Lesson 1', moduleId: 1, isPublished: true, contentMd: '' };
const activity = (id: number) => ({
  id,
  title: `Activity ${id}`,
  instructionsMd: '',
  position: id,
  question: '',
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

function wrap(overrides: Record<string, unknown> = {}) {
  const props = {
    loaderData: {
      course,
      module,
      lesson,
      activities: [activity(99)],
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
}

/** Run the updater `setSearchParams` was called with against the current URL. */
const resultingParams = () => {
  const updater = mockSetSearchParams.mock.calls.at(-1)?.[0];
  return typeof updater === 'function'
    ? (updater(new URLSearchParams(currentSearchParams)) as URLSearchParams)
    : (updater as URLSearchParams);
};

describe('instructor.lesson — duplicate activity placement (#1207)', () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    mockDuplicateActivity.mockReset().mockResolvedValue(activity(100));
    mockActivitiesForLesson.mockReset().mockResolvedValue({
      data: [activity(99)],
      total: 61,
      page: 3,
      pageSize: 25,
    });
    mockSetSearchParams.mockReset();
    mockToastError.mockClear();
  });

  it('navigates to the page the clone actually lands on', async () => {
    wrap();

    fireEvent.click(screen.getByLabelText('Duplicate activity'));

    await waitFor(() => expect(mockDuplicateActivity).toHaveBeenCalledWith(99));
    // 60 + the clone = 61 rows at 25 per page, so the clone is on page 3.
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled());
    expect(resultingParams().get('page')).toBe('3');
  });

  it('does not splice the clone onto the visible page', async () => {
    wrap();

    fireEvent.click(screen.getByLabelText('Duplicate activity'));
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled());

    // The clone belongs to page 3; page 1 must keep exactly the rows the
    // server gave it, or the drag ordinals below it stop matching the server.
    expect(screen.queryByText('Activity 100')).not.toBeInTheDocument();
  });

  it('clears an active search so the clone is not filtered out of view', async () => {
    currentSearchParams = new URLSearchParams({ search: 'traversal', page: '1' });
    wrap({ search: 'traversal', activitiesTotal: 2 });

    fireEvent.click(screen.getByLabelText('Duplicate activity'));

    // The filtered total is meaningless for placing the clone, so the real
    // count is re-read from the server before choosing the page.
    await waitFor(() =>
      expect(mockActivitiesForLesson).toHaveBeenCalledWith(1, { page: 1, search: '' }),
    );
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled());
    const params = resultingParams();
    expect(params.get('search')).toBeNull();
    expect(params.get('page')).toBe('3');
  });
});
