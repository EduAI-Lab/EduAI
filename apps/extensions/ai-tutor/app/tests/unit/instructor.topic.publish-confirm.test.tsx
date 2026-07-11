import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor.topic';

const mockPublishLesson = vi.fn().mockResolvedValue({ id: 20, title: 'Lesson 1', isPublished: true });
const mockUnpublishLesson = vi.fn().mockResolvedValue({ id: 20, title: 'Lesson 1', isPublished: false });

vi.mock('~/lib/api', () => ({
  default: {
    moduleById: vi.fn().mockResolvedValue({ id: 5, title: 'Module 1', courseOfferingId: 42, isPublished: true }),
    courseById: vi.fn().mockResolvedValue({ id: 42, title: 'Test Course', isPublished: true }),
    lessonsForModule: vi.fn().mockResolvedValue([]),
    publishLesson: (...args: unknown[]) => mockPublishLesson(...args),
    unpublishLesson: (...args: unknown[]) => mockUnpublishLesson(...args),
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
    useParams: () => ({ courseId: '42', moduleId: '5' }),
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

import InstructorModuleLessons from '~/routes/instructor.topic';

const module_ = { id: 5, title: 'Module 1', courseOfferingId: 42, isPublished: true };
const course = { id: 42, title: 'Test Course', isPublished: true };
const lesson = { id: 20, title: 'Lesson 1', isPublished: false };

function wrap(lessons = [lesson]) {
  const props = { loaderData: { module: module_, course, lessons } } as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorModuleLessons {...props} />
    </MemoryRouter>,
  );
}

describe('instructor.topic — publish/unpublish lesson confirmation dialog', () => {
  beforeEach(() => {
    mockPublishLesson.mockClear();
    mockUnpublishLesson.mockClear();
  });

  it('clicking the lesson publish button opens the dialog without calling the API', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(mockPublishLesson).not.toHaveBeenCalled();
    expect(mockUnpublishLesson).not.toHaveBeenCalled();
  });

  it('confirming calls publishLesson with the lesson id', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    });

    expect(mockPublishLesson).toHaveBeenCalledWith(lesson.id);
  });

  it('cancelling does not call the API', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublished$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    expect(mockPublishLesson).not.toHaveBeenCalled();
    expect(mockUnpublishLesson).not.toHaveBeenCalled();
  });

  it('confirming unpublish calls unpublishLesson', async () => {
    wrap([{ ...lesson, isPublished: true }]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^published$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublish$/i }));
    });

    expect(mockUnpublishLesson).toHaveBeenCalledWith(lesson.id);
  });
});
