/**
 * Unit tests for `ProfileCoursesDialog` (#1546): loads AI-service courses on open,
 * lets the user select ones not yet linked, saves them (create + link + optional
 * practice exam), and offers a re-sync path for already-added courses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const listCourses = vi.fn();
const listCoreCourseTopics = vi.fn();
const createCourse = vi.fn();
const linkAndSyncFromCore = vi.fn();
const deleteCourse = vi.fn();
const syncTopicsFromCore = vi.fn();
const createPracticeExamForCourse = vi.fn();
const logout = vi.fn();

vi.mock('@/services/eduaiService', () => ({
  eduaiService: {
    listCourses: (...args: unknown[]) => listCourses(...args),
    listCoreCourseTopics: (...args: unknown[]) => listCoreCourseTopics(...args),
  },
}));

vi.mock('@/services/courseService', () => ({
  courseService: {
    createCourse: (...args: unknown[]) => createCourse(...args),
    linkAndSyncFromCore: (...args: unknown[]) => linkAndSyncFromCore(...args),
    deleteCourse: (...args: unknown[]) => deleteCourse(...args),
    syncTopicsFromCore: (...args: unknown[]) => syncTopicsFromCore(...args),
  },
}));

vi.mock('@/services/assessmentService', () => ({
  assessmentService: {
    createPracticeExamForCourse: (...args: unknown[]) => createPracticeExamForCourse(...args),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ logout, user: { id: '1', role: 'instructor' } }),
}));

vi.mock('@/hooks/useEduAIStatus', () => ({
  useEduAIStatus: () => ({ status: 'ok', message: '', provider: null, refresh: vi.fn() }),
}));

vi.mock('@/components/eduai/AIServiceIndicators', () => ({
  AIServiceIndicators: () => <div data-testid="ai-indicators" />,
}));

vi.mock('sonner', () => {
  const toast = vi.fn() as any;
  toast.error = vi.fn();
  return { toast };
});

import { ProfileCoursesDialog } from '@/components/profile/ProfileCoursesDialog';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseProps = {
  open: true,
  onClose: vi.fn(),
  existingCourses: [],
};

describe('ProfileCoursesDialog', () => {
  it('loads and renders AI-service courses when opened', async () => {
    listCourses.mockResolvedValue([
      { id: 'core-1', code: 'CPSC 101', name: 'Intro to CS' },
    ]);
    listCoreCourseTopics.mockResolvedValue([]);

    render(<ProfileCoursesDialog {...baseProps} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/CPSC 101/)).toBeInTheDocument());
  });

  it('shows an error message when loading courses fails', async () => {
    listCourses.mockRejectedValue(new Error('boom'));

    render(<ProfileCoursesDialog {...baseProps} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Failed to load AI service courses/)).toBeInTheDocument()
    );
  });

  it('renders an "Already added" badge with a re-sync action for linked courses', async () => {
    listCourses.mockResolvedValue([{ id: 'core-1', code: 'CPSC 101', name: 'Intro to CS' }]);
    listCoreCourseTopics.mockResolvedValue([]);
    syncTopicsFromCore.mockResolvedValue(undefined);

    render(
      <ProfileCoursesDialog
        {...baseProps}
        onClose={vi.fn()}
        existingCourses={[{ id: 5, coreCourseId: 'core-1' } as any]}
      />
    );

    await waitFor(() => expect(screen.getByText('Already added')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Re-sync from Core/ }));

    await waitFor(() => expect(syncTopicsFromCore).toHaveBeenCalledWith(5));
  });

  it('selects a course, saves it, and calls onCoursesAdded', async () => {
    listCourses.mockResolvedValue([{ id: 'core-2', code: 'MATH 200', name: 'Calculus' }]);
    listCoreCourseTopics.mockResolvedValue([]);
    createCourse.mockResolvedValue({ id: 9 });
    linkAndSyncFromCore.mockResolvedValue(undefined);
    createPracticeExamForCourse.mockResolvedValue(undefined);
    const onCoursesAdded = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <ProfileCoursesDialog {...baseProps} onClose={onClose} onCoursesAdded={onCoursesAdded} />
    );

    await waitFor(() => expect(screen.getByText(/MATH 200/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Add selected courses/ }));

    await waitFor(() => expect(createCourse).toHaveBeenCalledWith({ coreCourseId: 'core-2' }));
    expect(linkAndSyncFromCore).toHaveBeenCalledWith(9, 'core-2');
    await waitFor(() => expect(onCoursesAdded).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('rolls back (deletes) the created course when linking fails', async () => {
    listCourses.mockResolvedValue([{ id: 'core-3', code: 'PHYS 100', name: 'Physics' }]);
    listCoreCourseTopics.mockResolvedValue([]);
    createCourse.mockResolvedValue({ id: 11 });
    linkAndSyncFromCore.mockRejectedValue(new Error('link failed'));
    deleteCourse.mockResolvedValue(undefined);

    render(<ProfileCoursesDialog {...baseProps} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/PHYS 100/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Add selected courses/ }));

    await waitFor(() => expect(deleteCourse).toHaveBeenCalledWith(11));
    await waitFor(() =>
      expect(screen.getByText(/Unable to add selected courses/)).toBeInTheDocument()
    );
  });

  it('calls logout and onClose when the Logout button is clicked', async () => {
    listCourses.mockResolvedValue([]);
    const onClose = vi.fn();

    render(<ProfileCoursesDialog {...baseProps} onClose={onClose} />);
    await waitFor(() => expect(listCourses).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Logout/ }));

    expect(onClose).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });

  it('does not render course options while closed', () => {
    render(<ProfileCoursesDialog {...baseProps} open={false} onClose={vi.fn()} />);
    expect(listCourses).not.toHaveBeenCalled();
  });
});
