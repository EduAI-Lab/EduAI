/**
 * Student-surface paging tests (#1207).
 *
 * The module grid used to render one bounded page as if it were the whole
 * tree, and the lesson player index-walked a single page — so a long lesson's
 * tail was simply unreachable. These pin the pager and the append-as-you-go
 * walk.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const mockActivitiesForLesson = vi.fn();
const mockSetSearchParams = vi.fn();

vi.mock('~/lib/api', () => ({
  default: {
    courseById: vi.fn(),
    modulesForCourse: vi.fn(),
    activitiesForLesson: (...args: unknown[]) => mockActivitiesForLesson(...args),
    submitAnswer: vi.fn(),
    mySubmissions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ courseId: '1', lessonId: '3' }),
    useNavigation: () => ({ state: 'idle' }),
    useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
  };
});

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: { id: 'u1', name: 'Student', role: 'STUDENT' } }),
}));
vi.mock('~/hooks/useCourseTopics', () => ({
  useCourseTopics: () => ({ topics: [], total: 0, loading: false }),
  CourseTopicsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/layout/ShellBreadcrumbContext', () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock('~/components/layout/CourseSwitcher', () => ({ CourseSwitcher: () => null }));
vi.mock('~/components/bug-report/useBugReport', () => ({
  useBugReport: () => ({ setContext: vi.fn(), clearContext: vi.fn() }),
}));
vi.mock('~/components/StudentAiChat', () => ({ default: () => null }));

import StudentCourseModules from '~/routes/student.course';
import StudentLessonPlayer from '~/routes/student.lesson';

const course = { id: 1, title: 'Course 1', code: 'COSC 101', isPublished: true };

describe('student.course — paged module grid (#1207)', () => {
  const wrap = (overrides: Record<string, unknown> = {}) =>
    render(
      <MemoryRouter>
        <StudentCourseModules
          {...({
            loaderData: {
              course,
              modules: [{ id: 10, title: 'Module A', description: '', position: 0 }],
              modulesTotal: 60,
              page: 1,
              pageSize: 25,
              ...overrides,
            },
          } as unknown as React.ComponentProps<typeof StudentCourseModules>)}
        />
      </MemoryRouter>,
    );

  beforeEach(() => {
    mockSetSearchParams.mockClear();
  });

  it('counts the whole course in the badge, not the loaded page', () => {
    wrap();
    expect(screen.getByText('60 modules')).toBeInTheDocument();
  });

  it('renders a pager driven by the total', () => {
    wrap();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
  });

  it('pushes the chosen page into the URL', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(mockSetSearchParams).toHaveBeenCalled();
    const updater = mockSetSearchParams.mock.calls[0][0] as (p: URLSearchParams) => URLSearchParams;
    expect(updater(new URLSearchParams()).get('page')).toBe('2');
  });

  it('hides the pager when the course fits on one page', () => {
    wrap({ modulesTotal: 1 });
    expect(screen.queryByLabelText('Pagination')).not.toBeInTheDocument();
  });
});

describe('student.lesson — paged activity walk (#1207)', () => {
  const activity = (id: number) => ({
    id,
    title: `Activity ${id}`,
    instructionsMd: '',
    position: id,
    question: `Question ${id}`,
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

  const wrap = (overrides: Record<string, unknown> = {}) =>
    render(
      <MemoryRouter>
        <StudentLessonPlayer
          {...({
            loaderData: {
              course,
              module: { id: 2, title: 'Module', courseOfferingId: 1 },
              lesson: { id: 3, title: 'Lesson', moduleId: 2, isPublished: true, contentMd: '' },
              activities: [activity(1), activity(2)],
              activitiesTotal: 2,
              orderText: '3.2',
              ...overrides,
            },
          } as unknown as React.ComponentProps<typeof StudentLessonPlayer>)}
        />
      </MemoryRouter>,
    );

  beforeEach(() => {
    mockActivitiesForLesson.mockReset();
    mockActivitiesForLesson.mockResolvedValue({
      data: [activity(3)],
      total: 3,
      page: 2,
      pageSize: 50,
    });
  });

  it('counts the whole lesson, not the loaded slice', () => {
    // `activitiesTotal` drives the "1 of N" readout; using the loaded length
    // would understate a lesson whose tail has not been fetched yet.
    wrap({ activitiesTotal: 120 });
    // The count renders in both the header and the footer of the player.
    expect(screen.getAllByText(/question 1 of 120/i).length).toBeGreaterThan(0);
  });

  it('does not fetch more while the whole lesson is already loaded', async () => {
    wrap({ activitiesTotal: 2 });
    await waitFor(() => expect(mockActivitiesForLesson).not.toHaveBeenCalled());
  });

  it('appends the next page when the walk nears the end of what is loaded', async () => {
    // 2 loaded of 3 total, and the prefetch margin is 5 — so index 0 is
    // already close enough to trigger the top-up.
    await act(async () => {
      wrap({ activitiesTotal: 3 });
    });

    await waitFor(() => expect(mockActivitiesForLesson).toHaveBeenCalled());
    expect(mockActivitiesForLesson).toHaveBeenCalledWith(3, { page: 2, pageSize: 50 });
  });

  it('shows the server-derived order text', () => {
    wrap();
    expect(screen.getAllByText(/3\.2/).length).toBeGreaterThan(0);
  });
});
