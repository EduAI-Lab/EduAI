/**
 * Coverage for student.module.tsx: loader wiring, empty state, lesson grid
 * rendering, and the aggregate module-progress computation.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Route } from '../../routes/+types/student.module';

const mockModuleById = vi.fn();
const mockLessonsForModule = vi.fn();
const mockCourseById = vi.fn();
const mockModuleContext = vi.fn();

vi.mock('~/lib/api', () => ({
  default: {
    moduleById: (...args: unknown[]) => mockModuleById(...args),
    lessonsForModule: (...args: unknown[]) => mockLessonsForModule(...args),
    courseById: (...args: unknown[]) => mockCourseById(...args),
    moduleContext: (...args: unknown[]) => mockModuleContext(...args),
  },
  FULL_TREE_READ_PAGE_SIZE: 200,
}));

vi.mock('~/lib/client-auth', () => ({
  requireClientUser: vi.fn().mockResolvedValue({ id: 'u1', role: 'STUDENT' }),
}));

vi.mock('~/components/layout/ShellBreadcrumbContext', () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock('~/components/layout/CourseSwitcher', () => ({ CourseSwitcher: () => null }));

import StudentModuleLessons, { clientLoader } from '~/routes/student.module';

const course = { id: 1, title: 'Intro Course', code: 'CS 101', isPublished: true };
const module_ = { id: 5, title: 'Module 1', description: 'About the module', courseOfferingId: 1 };

function wrap(overrides: Record<string, unknown> = {}) {
  const props = {
    loaderData: {
      course,
      module: module_,
      lessons: [],
      moduleOrder: 1,
      ...overrides,
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <StudentModuleLessons {...props} />
    </MemoryRouter>,
  );
}

describe('student.module — clientLoader', () => {
  beforeEach(() => {
    mockModuleById.mockReset();
    mockLessonsForModule.mockReset();
    mockCourseById.mockReset();
    mockModuleContext.mockReset();
  });

  it('throws a 400 Response for a non-numeric module id', async () => {
    await expect(
      clientLoader({ params: { moduleId: 'abc' } } as unknown as Route.ClientLoaderArgs),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('loads the module, lessons, course, and ordinal', async () => {
    mockModuleById.mockResolvedValue({ id: 5, title: 'Module 1', courseOfferingId: 1 });
    mockLessonsForModule.mockResolvedValue({ data: [{ id: 10, title: 'Lesson A' }], total: 1 });
    mockCourseById.mockResolvedValue(course);
    mockModuleContext.mockResolvedValue({ moduleOrdinal: 2 });

    const result = await clientLoader({
      params: { moduleId: '5' },
    } as unknown as Route.ClientLoaderArgs);

    expect(mockLessonsForModule).toHaveBeenCalledWith(5, { pageSize: 200 });
    expect(result).toEqual({
      course,
      module: { id: 5, title: 'Module 1', courseOfferingId: 1 },
      lessons: [{ id: 10, title: 'Lesson A' }],
      moduleOrder: 2,
    });
  });

  it('skips the course/ordinal fetch when the module has no parent course', async () => {
    mockModuleById.mockResolvedValue({ id: 5, title: 'Orphan module', courseOfferingId: null });
    mockLessonsForModule.mockResolvedValue({ data: [], total: 0 });

    const result = await clientLoader({
      params: { moduleId: '5' },
    } as unknown as Route.ClientLoaderArgs);

    expect(mockCourseById).not.toHaveBeenCalled();
    expect(result.course).toBeNull();
    expect(result.moduleOrder).toBe(0);
  });
});

describe('student.module — rendering', () => {
  it('shows the empty state when the module has no lessons', () => {
    wrap({ lessons: [] });
    expect(screen.getByText(/no lessons available/i)).toBeInTheDocument();
  });

  it('renders a card for each lesson with an order text', () => {
    wrap({
      lessons: [
        { id: 1, title: 'Lesson A', contentMd: '', isPublished: true },
        { id: 2, title: 'Lesson B', contentMd: '', isPublished: true },
      ],
      moduleOrder: 3,
    });

    expect(screen.getByText('Lesson A')).toBeInTheDocument();
    expect(screen.getByText('Lesson B')).toBeInTheDocument();
    // "3.1" / "3.2" order text derived from moduleOrder + index; each renders
    // twice on the card (watermark + badge).
    expect(screen.getAllByText('3.1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3.2').length).toBeGreaterThan(0);
  });

  it('aggregates progress across lessons that have any', () => {
    wrap({
      lessons: [
        { id: 1, title: 'Lesson A', contentMd: '', isPublished: true, progress: { completed: 2, total: 4 } },
        { id: 2, title: 'Lesson B', contentMd: '', isPublished: true, progress: { completed: 1, total: 2 } },
        { id: 3, title: 'Lesson C', contentMd: '', isPublished: true, progress: { completed: 0, total: 0 } },
      ],
    });

    // Hero stats show the total activity count aggregated across lessons with
    // progress > 0 (4 + 2 = 6); lesson C is excluded (total 0).
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('falls back to a generic module title and description when unset', () => {
    wrap({ module: { id: 5, title: '', description: undefined, courseOfferingId: 1 } });
    expect(screen.getByRole('heading', { name: 'Module' })).toBeInTheDocument();
  });
});
