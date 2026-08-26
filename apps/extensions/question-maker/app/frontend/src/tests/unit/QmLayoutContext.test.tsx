/**
 * Unit tests for `QmLayoutProvider` / `useQmLayout` (#1546): the layout-scoped
 * context for the profile dialog's open state and the guided-tour handler slot.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QmLayoutProvider, useQmLayout } from '@/components/layout/QmLayoutContext';

describe('QmLayoutContext', () => {
  it('throws when used outside a QmLayoutProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useQmLayout())).toThrow(
      'useQmLayout must be used within QmLayoutProvider'
    );
    spy.mockRestore();
  });

  it('starts with the profile dialog closed and no guided tour handler', () => {
    const { result } = renderHook(() => useQmLayout(), {
      wrapper: ({ children }) => <QmLayoutProvider>{children}</QmLayoutProvider>,
    });

    expect(result.current.profileOpen).toBe(false);
    expect(result.current.guidedTourHandler).toBeNull();
  });

  it('openProfile / closeProfile toggle profileOpen', () => {
    const { result } = renderHook(() => useQmLayout(), {
      wrapper: ({ children }) => <QmLayoutProvider>{children}</QmLayoutProvider>,
    });

    act(() => result.current.openProfile());
    expect(result.current.profileOpen).toBe(true);

    act(() => result.current.closeProfile());
    expect(result.current.profileOpen).toBe(false);
  });

  it('setGuidedTourHandler stores and can clear the handler', () => {
    const { result } = renderHook(() => useQmLayout(), {
      wrapper: ({ children }) => <QmLayoutProvider>{children}</QmLayoutProvider>,
    });

    const handler = vi.fn();
    act(() => result.current.setGuidedTourHandler(handler));
    expect(result.current.guidedTourHandler).toBe(handler);

    act(() => result.current.setGuidedTourHandler(null));
    expect(result.current.guidedTourHandler).toBeNull();
  });
});
