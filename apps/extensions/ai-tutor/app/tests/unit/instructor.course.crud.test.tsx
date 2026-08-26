/**
 * Coverage for instructor.course.tsx flows not exercised by the paging /
 * publish-confirm suites: module create/edit/delete dialogs and the
 * cross-course module import drill-down.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/instructor.course';

const mockCreateModule = vi.fn();
const mockUpdateModule = vi.fn();
const mockDeleteModule = vi.fn();
const mockModulesForCourse = vi.fn();
const mockListCourses = vi.fn();
const mockImportIntoCourse = vi.fn();

vi.mock('~/lib/api', () => ({
  default: {
    courseById: vi.fn().mockResolvedValue({ id: 42, title: 'Test Course', isPublished: true }),
    modulesForCourse: (...args: unknown[]) => mockModulesForCourse(...args),
    listCourses: (...args: unknown[]) => mockListCourses(...args),
    createModule: (...args: unknown[]) => mockCreateModule(...args),
    updateModule: (...args: unknown[]) => mockUpdateModule(...args),
    deleteModule: (...args: unknown[]) => mockDeleteModule(...args),
    importIntoCourse: (...args: unknown[]) => mockImportIntoCourse(...args),
    publishModule: vi.fn(),
    unpublishModule: vi.fn(),
  },
  FULL_TREE_READ_PAGE_SIZE: 200,
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
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
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
vi.mock('~/components/courses/CourseFeedbackPanel', () => ({ CourseFeedbackPanel: () => null }));

vi.mock('@eduai/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eduai/ui')>()),
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/components/PublishMenu', () => ({
  PublishMenu: ({
    isPublished,
    onEdit,
    onDelete,
  }: {
    isPublished: boolean;
    onEdit?: () => void;
    onDelete?: () => void;
  }) => (
    <div>
      <span>{isPublished ? 'Published' : 'Unpublished'}</span>
      {onEdit && (
        <button type="button" onClick={onEdit}>
          Edit
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete}>
          Delete
        </button>
      )}
    </div>
  ),
}));

import InstructorCourseModules from '~/routes/instructor.course';

const course = { id: 42, title: 'Test Course', code: 'COSC 101', isPublished: true };
const module_ = {
  id: 10,
  title: 'Module 1',
  description: 'Old description',
  position: 0,
  isPublished: false,
};

function wrap(modules = [module_]) {
  const props = {
    loaderData: {
      course,
      modules,
      modulesTotal: modules.length,
      page: 1,
      pageSize: 25,
      search: '',
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorCourseModules {...props} />
    </MemoryRouter>,
  );
}

describe('instructor.course — add module dialog', () => {
  beforeEach(() => {
    mockCreateModule.mockReset();
    mockModulesForCourse.mockReset().mockResolvedValue({
      data: [module_],
      total: 1,
      page: 1,
      pageSize: 25,
    });
  });

  it('creates a module and closes the dialog', async () => {
    mockCreateModule.mockResolvedValue({ id: 11, title: 'New module' });
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^add module$/i }));
    });

    fireEvent.change(screen.getByLabelText(/module title/i), {
      target: { value: 'New module' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^add module$/i }));
    });

    await waitFor(() =>
      expect(mockCreateModule).toHaveBeenCalledWith(42, { title: 'New module' }),
    );
  });

  it('cancel does not create a module', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^add module$/i }));
    });
    fireEvent.change(screen.getByLabelText(/module title/i), { target: { value: 'Draft' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    });

    expect(mockCreateModule).not.toHaveBeenCalled();
  });
});

describe('instructor.course — edit module dialog', () => {
  beforeEach(() => {
    mockUpdateModule.mockReset();
    mockModulesForCourse.mockReset().mockResolvedValue({
      data: [module_],
      total: 1,
      page: 1,
      pageSize: 25,
    });
  });

  it('pre-fills the form and saves the update', async () => {
    mockUpdateModule.mockResolvedValue({ ...module_, title: 'Renamed module' });
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    });

    const titleInput = screen.getByLabelText(/module title/i) as HTMLInputElement;
    expect(titleInput.value).toBe('Module 1');
    const descriptionInput = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    expect(descriptionInput.value).toBe('Old description');

    fireEvent.change(titleInput, { target: { value: 'Renamed module' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });

    await waitFor(() =>
      expect(mockUpdateModule).toHaveBeenCalledWith(10, {
        title: 'Renamed module',
        description: 'Old description',
      }),
    );
  });
});

describe('instructor.course — delete module dialog', () => {
  beforeEach(() => {
    mockDeleteModule.mockReset();
    mockModulesForCourse.mockReset().mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });

  it('confirming delete calls deleteModule with the module id', async () => {
    mockDeleteModule.mockResolvedValue(undefined);
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    });

    expect(screen.getByRole('heading', { name: 'Delete module' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^delete module$/i }));
    });

    await waitFor(() => expect(mockDeleteModule).toHaveBeenCalledWith(10));
  });

  it('cancel does not delete', async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    });

    expect(mockDeleteModule).not.toHaveBeenCalled();
  });
});

describe('instructor.course — cross-course module import', () => {
  beforeEach(() => {
    mockListCourses.mockReset().mockResolvedValue({
      data: [{ id: 42, title: 'Test Course' }, { id: 43, title: 'Other Course' }],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    mockModulesForCourse.mockReset().mockImplementation((courseId: number) => {
      if (courseId === 43) {
        return Promise.resolve({
          data: [{ id: 77, title: 'Source Module', description: '' }],
          total: 1,
          page: 1,
          pageSize: 200,
        });
      }
      return Promise.resolve({ data: [], total: 0, page: 1, pageSize: 25 });
    });
    mockImportIntoCourse.mockReset().mockResolvedValue(undefined);
  });

  it('walks course -> module selection and imports the selection', async () => {
    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^import$/i }));
    });

    await waitFor(() => expect(mockListCourses).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/choose course to copy/i));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText('Other Course'));
    });

    await waitFor(() =>
      expect(mockModulesForCourse).toHaveBeenCalledWith(43, { pageSize: 200 }),
    );

    await act(async () => {
      fireEvent.click(await screen.findByText('Source Module'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /import 1 module/i }));
    });

    await waitFor(() =>
      expect(mockImportIntoCourse).toHaveBeenCalledWith(42, {
        sourceCourseId: 43,
        moduleIds: [77],
      }),
    );
  });

  it('excludes the current course from the source list', async () => {
    wrap([]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^import$/i }));
    });

    await waitFor(() => expect(mockListCourses).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/choose course to copy/i));
    });

    expect(within(screen.getByRole('listbox')).queryByText('Test Course')).not.toBeInTheDocument();
  });
});
