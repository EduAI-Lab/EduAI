import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor.lesson';

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: vi.fn() } }));

const mockDeleteActivity = vi.fn().mockResolvedValue(undefined);

vi.mock('~/lib/api', () => ({
  default: {
    lessonById: vi.fn().mockResolvedValue({ id: 1, title: 'Lesson 1', moduleId: null }),
    activitiesForLesson: vi.fn().mockResolvedValue([]),
    deleteActivity: (...args: unknown[]) => mockDeleteActivity(...args),
    syncTopics: vi.fn().mockResolvedValue({ missingTopics: 0 }),
  },
}));

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: { id: 'u1', name: 'Instructor', role: 'INSTRUCTOR', authorizedUnits: [] } }),
}));

vi.mock('~/hooks/useAtPermissions', () => ({
  useAtPermissions: () => ({ canManageContent: true, canPublishContent: true }),
}));

vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ lessonId: '1' }),
  };
});

vi.mock('~/hooks/useCourseTopics', () => ({
  CourseTopicsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCourseTopics: () => ({ topics: [], loading: false }),
}));

// Redesigned lesson page publishes its breadcrumb trail through the shell
// context; the old instructor.list route did not, so this mock is new.
vi.mock('~/components/layout/ShellBreadcrumbContext', () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));

// PermissionGate now ships from @eduai/ui — partial-mock so the other primitives
// this route imports keep their real implementations.
vi.mock('@eduai/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eduai/ui')>()),
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/components/AddActivityPanel', () => ({ default: () => null }));
vi.mock('~/components/EditActivityPanel', () => ({ default: () => null }));
vi.mock('~/components/ActivityDetailsCard', () => ({ default: () => null }));
vi.mock('~/components/AddCourseTopicsButton', () => ({ default: () => null }));
vi.mock('~/components/bug-report/useBugReport', () => ({ useBugReport: () => ({ setBugContext: vi.fn() }) }));
vi.mock('~/components/TourButton', () => ({ default: () => null }));
vi.mock('~/components/TourProvider', () => ({ TourProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useAppTour: () => ({}) }));

import InstructorLessonBuilder from '~/routes/instructor.lesson';

const course = { id: 1, title: 'Course 1', code: 'COSC 101', isPublished: true };
const module = { id: 1, title: 'Module 1', description: '', position: 0, courseOfferingId: 1, lessons: [] };
const lesson = { id: 1, title: 'Lesson 1', moduleId: 1, isPublished: true, contentMd: '' };
const activity = {
  id: 99,
  title: 'Activity 1',
  instructionsMd: '',
  position: 0,
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
};

function wrap(activities = [activity]) {
  const props = {
    loaderData: { course, module, lesson, activities, orderText: '1.1' },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorLessonBuilder {...props} />
    </MemoryRouter>,
  );
}

describe('instructor.lesson — delete activity confirmation dialog', () => {
  beforeEach(() => {
    mockDeleteActivity.mockClear();
    mockToastError.mockClear();
  });

  it('clicking Remove opens the dialog without calling the API', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove activity/i }));
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(mockDeleteActivity).not.toHaveBeenCalled();
  });

  it('confirming calls deleteActivity with the activity id', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove activity/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });

    await waitFor(() => {
      expect(mockDeleteActivity).toHaveBeenCalledWith(activity.id);
    });
  });

  it('cancelling does not call deleteActivity', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove activity/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    expect(mockDeleteActivity).not.toHaveBeenCalled();
  });

  it('shows a toast error when deleteActivity fails', async () => {
    mockDeleteActivity.mockRejectedValueOnce(new Error('network error'));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove activity/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/failed/i));
    });
  });
});
