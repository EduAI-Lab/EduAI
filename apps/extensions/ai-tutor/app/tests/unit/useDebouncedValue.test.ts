import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_DEBOUNCE_MS, useDebouncedValue } from '~/hooks/useDebouncedValue';

describe('useDebouncedValue (#1208)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('cosc'));
    expect(result.current).toBe('cosc');
  });

  it('withholds a new value until the delay elapses', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'ab' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    });
    expect(result.current).toBe('ab');
  });

  it('coalesces a burst of changes into one update', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: '' },
    });

    // Typing "cosc" one character at a time, faster than the delay.
    for (const v of ['c', 'co', 'cos', 'cosc']) {
      rerender({ v });
      act(() => {
        vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS - 50);
      });
    }
    // Nothing has settled yet — this is what stops a request per keystroke.
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    });
    expect(result.current).toBe('cosc');
  });

  it('honours a custom delay', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 1000), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'b' });
    act(() => {
      vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('b');
  });

  it('does not update after unmount', () => {
    const { result, rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'b' });
    unmount();

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 2);
    });
    // Still the pre-unmount value; the timer was cleaned up rather than firing
    // a setState on an unmounted component.
    expect(result.current).toBe('a');
  });

  it('works for non-string values', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: ['a'] as string[] },
    });

    rerender({ v: ['a', 'b'] });
    act(() => {
      vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    });
    expect(result.current).toEqual(['a', 'b']);
  });
});
