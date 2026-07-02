import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import StudentHome from '~/routes/student';
import type { Route } from '../../routes/+types/student';
import { AuthProvider } from '~/hooks/useLocalUser';
import type { Course } from '~/lib/types';

vi.mock('~/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderStudentHome(role: 'STUDENT' | 'TA', courses: Course[]) {
  const props = { loaderData: { courses } } as Route.ComponentProps;
  return render(
    <AuthProvider initialUser={{ id: 'u1', name: 'User', role }}>
      <MemoryRouter initialEntries={['/student']}>
        <StudentHome {...props} />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('StudentHome (#746 review: TA preview must stay student-shaped)', () => {
  const courses = [{ id: 1, title: 'Course 1', isPublished: true }];

  it('renders student stats for a STUDENT', () => {
    renderStudentHome('STUDENT', courses);
    expect(screen.getByText('Enrolled courses')).toBeInTheDocument();
  });

  it('still renders student stats (not instructor stats) for a TA previewing /student', () => {
    renderStudentHome('TA', courses);
    expect(screen.getByText('Enrolled courses')).toBeInTheDocument();
    expect(screen.queryByText('Your courses')).not.toBeInTheDocument();
  });
});
