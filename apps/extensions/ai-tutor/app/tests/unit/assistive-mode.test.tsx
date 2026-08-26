import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistiveModeProvider, useAssistiveMode } from '~/components/settings/assistive-mode';

const STORAGE_KEY = 'eduai:assistive';

describe('AssistiveModeProvider / useAssistiveMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-assistive');
  });

  it('throws when used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAssistiveMode())).toThrow(
      'useAssistiveMode must be used within an AssistiveModeProvider',
    );
    spy.mockRestore();
  });

  it('defaults to off and no data-assistive attribute', () => {
    const { result } = renderHook(() => useAssistiveMode(), {
      wrapper: AssistiveModeProvider,
    });
    expect(result.current.assistive).toBe(false);
    expect(document.documentElement.hasAttribute('data-assistive')).toBe(false);
  });

  it('reads the initial value from localStorage', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useAssistiveMode(), {
      wrapper: AssistiveModeProvider,
    });
    expect(result.current.assistive).toBe(true);
  });

  it('setting assistive=true sets the data-assistive attribute and persists it', () => {
    const { result } = renderHook(() => useAssistiveMode(), {
      wrapper: AssistiveModeProvider,
    });

    act(() => {
      result.current.setAssistive(true);
    });

    expect(result.current.assistive).toBe(true);
    expect(document.documentElement.getAttribute('data-assistive')).toBe('true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('setting assistive=false removes the attribute entirely (not "false")', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useAssistiveMode(), {
      wrapper: AssistiveModeProvider,
    });
    expect(document.documentElement.hasAttribute('data-assistive')).toBe(true);

    act(() => {
      result.current.setAssistive(false);
    });

    expect(document.documentElement.hasAttribute('data-assistive')).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('renders children', () => {
    render(
      <AssistiveModeProvider>
        <div data-testid="child">Hello</div>
      </AssistiveModeProvider>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
