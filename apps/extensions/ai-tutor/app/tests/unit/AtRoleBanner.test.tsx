import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AtRoleBanner } from '~/components/rbac/AtRoleBanner';

describe('AtRoleBanner', () => {
  it('shows TA read-only copy', () => {
    render(<AtRoleBanner role="TA" variant="ta" />);
    expect(screen.getByTestId('at-role-banner-ta')).toBeTruthy();
    expect(screen.getByText(/Teaching assistant view/i)).toBeTruthy();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it('shows authorized units for unit admin', () => {
    render(
      <AtRoleBanner role="UNIT_ADMIN" variant="unit-admin" authorizedUnits={['COSC', 'MATH']} />,
    );
    expect(screen.getByText(/Authorized units:/)).toBeTruthy();
    expect(screen.getByText(/COSC, MATH/)).toBeTruthy();
  });
});
