import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PermissionGate } from '~/components/rbac/PermissionGate';

describe('PermissionGate', () => {
  it('renders children when allowed', () => {
    render(
      <PermissionGate allow={true}>
        <span>Visible action</span>
      </PermissionGate>,
    );
    expect(screen.getByText('Visible action')).toBeTruthy();
  });

  it('hides children when denied', () => {
    render(
      <PermissionGate allow={false}>
        <span>Hidden action</span>
      </PermissionGate>,
    );
    expect(screen.queryByText('Hidden action')).toBeNull();
  });

  it('renders fallback when denied', () => {
    render(
      <PermissionGate allow={false} fallback={<span>Read only</span>}>
        <span>Hidden action</span>
      </PermissionGate>,
    );
    expect(screen.getByText('Read only')).toBeTruthy();
  });
});
