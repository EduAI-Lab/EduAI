/**
 * Unit tests for `CoursesGrid` (#1546): QM's thin wrapper over the shared
 * `@eduai/ui` CourseListView — click-to-select cards, empty state, and the
 * loading skeleton branch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { CoursesGrid } from '@/components/courses/CoursesGrid';
import type { Course } from '@/types/question';

afterEach(() => cleanup());

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    name: 'Intro to CS',
    code: 'CPSC 101',
    term: 'Fall',
    year: 2025,
    ...overrides,
  } as Course;
}

describe('CoursesGrid', () => {
  it('renders a course card for each course', () => {
    render(
      <CoursesGrid courses={[makeCourse()]} isLoading={false} onSelectCourse={vi.fn()} />
    );
    expect(screen.getByText('CPSC 101')).toBeInTheDocument();
  });

  it('calls onSelectCourse when a course card is clicked', () => {
    const onSelectCourse = vi.fn();
    const course = makeCourse();
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={onSelectCourse} />);

    fireEvent.click(screen.getByRole('button', { name: /CPSC 101/ }));
    expect(onSelectCourse).toHaveBeenCalledWith(course);
  });

  it('supports keyboard activation on a course card', () => {
    const onSelectCourse = vi.fn();
    const course = makeCourse();
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={onSelectCourse} />);

    fireEvent.keyDown(screen.getByRole('button', { name: /CPSC 101/ }), { key: 'Enter' });
    expect(onSelectCourse).toHaveBeenCalledWith(course);
  });

  it('shows the empty state (with a default hint) when there are no courses', () => {
    render(<CoursesGrid courses={[]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText('No courses yet')).toBeInTheDocument();
  });

  it('shows a custom empty hint when provided', () => {
    render(
      <CoursesGrid
        courses={[]}
        isLoading={false}
        onSelectCourse={vi.fn()}
        emptyHint="Ask an admin to enroll you."
      />
    );
    expect(screen.getByText('Ask an admin to enroll you.')).toBeInTheDocument();
  });

  it('shows a loading skeleton instead of course cards while isLoading', () => {
    render(<CoursesGrid courses={[makeCourse()]} isLoading onSelectCourse={vi.fn()} />);
    expect(screen.queryByText('CPSC 101')).toBeNull();
  });

  it('tags the first course for the guided tour when no explicit highlight is given', () => {
    const course = makeCourse({ id: 42 });
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(document.querySelector('[data-tour-id="course-select"]')).toHaveAttribute(
      'data-course-id',
      '42'
    );
  });
});
