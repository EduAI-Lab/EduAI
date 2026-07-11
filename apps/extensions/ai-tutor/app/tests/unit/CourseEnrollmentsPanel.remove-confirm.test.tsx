import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CourseEnrollmentsPanel } from '~/components/courses/CourseEnrollmentsPanel';

const mockRemoveStudentFromCourse = vi.fn().mockResolvedValue(undefined);
const mockGetAdminCourseEnrollments = vi.fn().mockResolvedValue({
  enrolledStudents: [
    { id: 's1', name: 'Alice', email: 'alice@test.com', role: 'STUDENT' },
  ],
});

vi.mock('~/lib/api', () => ({
  default: {
    getAdminCourseEnrollments: (...args: unknown[]) => mockGetAdminCourseEnrollments(...args),
    removeStudentFromCourse: (...args: unknown[]) => mockRemoveStudentFromCourse(...args),
    updateEnrollmentRole: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('CourseEnrollmentsPanel — remove student confirmation dialog', () => {
  beforeEach(() => {
    mockRemoveStudentFromCourse.mockClear();
    mockGetAdminCourseEnrollments.mockClear();
  });

  function wrap() {
    return render(<CourseEnrollmentsPanel courseId={1} canManage={true} canAssignTa={true} />);
  }

  it('clicking Remove opens the dialog without calling the API', async () => {
    wrap();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(mockRemoveStudentFromCourse).not.toHaveBeenCalled();
  });

  it('confirming calls removeStudentFromCourse with the student id', async () => {
    wrap();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });

    await waitFor(() => {
      expect(mockRemoveStudentFromCourse).toHaveBeenCalledWith(1, 's1');
    });
  });

  it('cancelling does not call removeStudentFromCourse', async () => {
    wrap();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    expect(mockRemoveStudentFromCourse).not.toHaveBeenCalled();
  });

  it('Remove button is disabled while removal is in progress', async () => {
    let resolveRemove!: () => void;
    mockRemoveStudentFromCourse.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveRemove = resolve; }),
    );

    wrap();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });

    expect(screen.getByRole('button', { name: /^remove$/i })).toBeDisabled();

    await act(async () => { resolveRemove(); });
  });
});
