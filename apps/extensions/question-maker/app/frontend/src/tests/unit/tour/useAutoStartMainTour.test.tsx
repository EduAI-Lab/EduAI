import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const hasSeenMainTourMock = vi.fn();

vi.mock('../../../tour/mainTourStorage', () => ({
  hasSeenMainTour: () => hasSeenMainTourMock(),
}));

import { useAutoStartMainTour } from '../../../tour/useAutoStartMainTour';

describe('useAutoStartMainTour', () => {
  const onStartMock = vi.fn();
  let idleCallbackSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hasSeenMainTourMock.mockReset();
    onStartMock.mockReset();

    idleCallbackSpy = vi.fn((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', idleCallbackSpy);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('calls onStart when unseen and enabled', () => {
    hasSeenMainTourMock.mockReturnValue(false);

    renderHook(() => useAutoStartMainTour({ enabled: true, onStart: onStartMock }));

    expect(idleCallbackSpy).toHaveBeenCalled();
    expect(onStartMock).toHaveBeenCalledTimes(1);
  });

  it('does not call onStart when main tour has been seen', () => {
    hasSeenMainTourMock.mockReturnValue(true);

    renderHook(() => useAutoStartMainTour({ enabled: true, onStart: onStartMock }));

    expect(onStartMock).not.toHaveBeenCalled();
    expect(idleCallbackSpy).not.toHaveBeenCalled();
  });

  it('does not start when disabled, then starts when enabled becomes true', () => {
    hasSeenMainTourMock.mockReturnValue(false);

    const { rerender } = renderHook(
      ({ enabled }) => useAutoStartMainTour({ enabled, onStart: onStartMock }),
      { initialProps: { enabled: false } }
    );

    expect(onStartMock).not.toHaveBeenCalled();
    expect(idleCallbackSpy).not.toHaveBeenCalled();

    rerender({ enabled: true });

    expect(onStartMock).toHaveBeenCalledTimes(1);
  });
});
