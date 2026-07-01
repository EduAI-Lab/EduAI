import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoleDashboard } from '~/components/dashboard/RoleDashboard';

describe('RoleDashboard', () => {
  it('renders the shared shell: banner, heading, stats, accessory, body, and tour id', () => {
    const { container } = render(
      <RoleDashboard
        heading="Courses"
        subheading="sub"
        stats={[{ label: 'Enrolled courses', value: 3 }]}
        banner={<div>BANNER</div>}
        headingAccessory={<div>ACC</div>}
        headingTourId="student-dashboard-header"
      >
        <div>BODY</div>
      </RoleDashboard>,
    );

    expect(screen.getByText('Courses')).toBeInTheDocument();
    expect(screen.getByText('Enrolled courses')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('BANNER')).toBeInTheDocument();
    expect(screen.getByText('ACC')).toBeInTheDocument();
    expect(screen.getByText('BODY')).toBeInTheDocument();
    // Guided-tour target preserved on the heading row.
    expect(container.querySelector('[data-tour="student-dashboard-header"]')).toBeTruthy();
  });

  it('omits the tour attribute when no headingTourId is given (admin/instructor)', () => {
    const { container } = render(
      <RoleDashboard heading="Admin console" subheading="s" stats={[]} />,
    );
    expect(container.querySelector('[data-tour]')).toBeNull();
    expect(screen.getByText('Admin console')).toBeInTheDocument();
  });
});
