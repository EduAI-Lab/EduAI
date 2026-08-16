import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

const navigateMock = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const hasSeenMainTourMock = vi.fn();

vi.mock('../../../tour/mainTourStorage', () => ({
  hasSeenMainTour: () => hasSeenMainTourMock(),
}));

import { useAutoRedirectForMainTour } from '../../../tour/useAutoRedirectForMainTour';

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useAutoRedirectForMainTour', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    hasSeenMainTourMock.mockReset();
  });

  afterEach(cleanup);

  it('redirects to /courses with replace when main tour has not been seen', () => {
    hasSeenMainTourMock.mockReturnValue(false);

    renderHook(() => useAutoRedirectForMainTour(), { wrapper });

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/courses', { replace: true });
  });

  it('does not redirect when main tour has been seen', () => {
    hasSeenMainTourMock.mockReturnValue(true);

    renderHook(() => useAutoRedirectForMainTour(), { wrapper });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
