/**
 * Coverage for instructor.lesson.tsx behaviours not exercised by the
 * delete/duplicate/import-picker suites: the add-activity panel toggle, the
 * inline activity editor's save/error paths, the per-activity AI mode
 * toggles (including the "at least one mode" guard), and the custom prompt
 * editor's validation + save/error paths.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor.lesson';

const mockUpdateActivity = vi.fn();

vi.mock('~/lib/api', () => ({
  default: {
    lessonById: vi.fn().mockResolvedValue({ id: 1, title: 'Lesson 1', moduleId: null }),
    activitiesForLesson: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 }),
    lessonBreadcrumb: vi.fn().mockResolvedValue({
      module: { id: 1, title: 'Module 1', courseOfferingId: 1 },
      course: { id: 1, title: 'Course 1', code: 'COSC 101' },
      moduleOrdinal: 1,
      lessonOrdinal: 1,
    }),
    updateActivity: (...args: unknown[]) => mockUpdateActivity(...args),
    deleteActivity: vi.fn().mockResolvedValue(undefined),
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

vi.mock('~/components/AddActivityPanel', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="add-activity-panel">
      <button type="button" onClick={onCancel}>
        Cancel add
      </button>
    </div>
  ),
}));
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
const lesson = { id: 1, title: 'Lesson 1', moduleId: 1, isPublished: true, contentMd: '' };

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    title: 'Activity 1',
    instructionsMd: '',
    position: 0,
    question: 'What is 2+2?',
    type: 'SHORT_TEXT' as const,
    options: null,
    answer: { text: '4' },
    hints: [],
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: false,
    enableCustomMode: false,
    customPrompt: null,
    customPromptTitle: null,
    ...overrides,
  };
}

function wrap(activities = [makeActivity()]) {
  const props = {
    loaderData: {
      course,
      module: module_,
      lesson,
      activities,
      activitiesTotal: activities.length,
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

describe('instructor.lesson — add-activity panel toggle', () => {
  it('opens the add-activity dialog and flips the button label', async () => {
    wrap([]);

    const toggle = screen.getByRole('button', { name: /^add activity$/i });
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.getByTestId('add-activity-panel')).toBeInTheDocument();
    // The toggle button sits outside the (Radix) dialog; while the dialog is
    // open Radix marks background siblings aria-hidden for a11y, so it must
    // be looked up with `hidden: true` rather than the default role query.
    expect(
      screen.getByRole('button', { name: /^hide$/i, hidden: true }),
    ).toBeInTheDocument();
  });
});

describe('instructor.lesson — inline activity edit', () => {
  beforeEach(() => {
    mockUpdateActivity.mockReset();
  });

  it('saves an edited activity and closes the editor', async () => {
    mockUpdateActivity.mockResolvedValue(makeActivity({ question: 'Updated question?' }));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit activity/i }));
    });

    const questionBox = screen.getByLabelText(/question prompt/i);
    fireEvent.change(questionBox, { target: { value: 'Updated question?' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });

    await waitFor(() => expect(mockUpdateActivity).toHaveBeenCalledWith(99, expect.any(Object)));
    // Editor closes back to the read-only card.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument(),
    );
  });

  it('shows an error and keeps the editor open when the save fails', async () => {
    mockUpdateActivity.mockRejectedValue(new Error('network'));
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit activity/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });

    await waitFor(() =>
      expect(screen.getByText(/could not save activity/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('cancel discards edits without calling the API', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit activity/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    });

    expect(mockUpdateActivity).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });
});

describe('instructor.lesson — AI mode toggles', () => {
  beforeEach(() => {
    mockUpdateActivity.mockReset();
  });

  it('enables an additional mode and persists it', async () => {
    mockUpdateActivity.mockResolvedValue(
      makeActivity({ enableTeachMode: true, enableGuideMode: true }),
    );
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /guide me/i }));
    });

    await waitFor(() =>
      expect(mockUpdateActivity).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ enableGuideMode: true }),
      ),
    );
  });

  it('refuses to disable the last remaining mode', async () => {
    wrap([makeActivity({ enableTeachMode: true, enableGuideMode: false, enableCustomMode: false })]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /teach me/i }));
    });

    await waitFor(() =>
      expect(screen.getByText(/At least one AI mode must be enabled/i)).toBeInTheDocument(),
    );
    expect(mockUpdateActivity).not.toHaveBeenCalled();
  });

  it('disabling custom mode clears the custom prompt server-side', async () => {
    mockUpdateActivity.mockResolvedValue(
      makeActivity({ enableTeachMode: true, enableCustomMode: false }),
    );
    wrap([
      makeActivity({
        enableTeachMode: true,
        enableCustomMode: true,
        customPrompt: 'Explain like I am 5',
        customPromptTitle: 'ELI5',
      }),
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /custom prompt/i }));
    });

    await waitFor(() =>
      expect(mockUpdateActivity).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ enableCustomMode: false, customPrompt: null }),
      ),
    );
  });
});

describe('instructor.lesson — custom prompt editor', () => {
  beforeEach(() => {
    mockUpdateActivity.mockReset();
  });

  it('requires a title before saving', async () => {
    wrap([makeActivity({ enableCustomMode: true })]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save prompt/i }));
    });

    expect(
      screen.getByText(/please provide a title for the custom prompt/i),
    ).toBeInTheDocument();
    expect(mockUpdateActivity).not.toHaveBeenCalled();
  });

  it('requires prompt text once a title is present', async () => {
    wrap([makeActivity({ enableCustomMode: true })]);

    fireEvent.change(screen.getByLabelText(/button title/i), {
      target: { value: 'Nudge' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save prompt/i }));
    });

    expect(screen.getByText(/please provide the custom prompt text/i)).toBeInTheDocument();
    expect(mockUpdateActivity).not.toHaveBeenCalled();
  });

  it('saves a valid custom prompt', async () => {
    mockUpdateActivity.mockResolvedValue(
      makeActivity({
        enableCustomMode: true,
        customPrompt: 'Walk through step by step',
        customPromptTitle: 'Step by step',
      }),
    );
    wrap([makeActivity({ enableCustomMode: true })]);

    fireEvent.change(screen.getByLabelText(/button title/i), {
      target: { value: 'Step by step' },
    });
    fireEvent.change(screen.getByLabelText(/custom ai prompt/i), {
      target: { value: 'Walk through step by step' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save prompt/i }));
    });

    await waitFor(() =>
      expect(mockUpdateActivity).toHaveBeenCalledWith(99, {
        customPrompt: 'Walk through step by step',
        customPromptTitle: 'Step by step',
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^saved$/i })).toBeInTheDocument());
  });

  it('shows an error and keeps the draft when saving fails', async () => {
    mockUpdateActivity.mockRejectedValue(new Error('network'));
    wrap([makeActivity({ enableCustomMode: true })]);

    fireEvent.change(screen.getByLabelText(/button title/i), { target: { value: 'Nudge' } });
    fireEvent.change(screen.getByLabelText(/custom ai prompt/i), {
      target: { value: 'Give a hint' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save prompt/i }));
    });

    await waitFor(() =>
      expect(screen.getByText(/could not save the custom prompt/i)).toBeInTheDocument(),
    );
  });

  it('truncates the button title to 20 characters', () => {
    wrap([makeActivity({ enableCustomMode: true })]);

    const titleInput = screen.getByLabelText(/button title/i) as HTMLInputElement;
    fireEvent.change(titleInput, {
      target: { value: 'This title is definitely far too long' },
    });

    expect(titleInput.value.length).toBe(20);
    expect(screen.getByText('20/20 characters')).toBeInTheDocument();
  });
});
