import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SidebarProvider } from '@eduai/ui';
import { describe, expect, it, vi } from 'vitest';
import TourButton from '~/components/TourButton';

const startSuggestedTour = vi.fn();
const stopTour = vi.fn();
let isRunning = false;

vi.mock('~/components/TourProvider', () => ({
  useAppTour: () => ({ isRunning, startSuggestedTour, stopTour }),
}));

function renderAt(path: string) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>{children}</SidebarProvider>
    </MemoryRouter>
  );
  return render(<TourButton />, { wrapper: Wrapper });
}

describe('TourButton', () => {
  it('renders an accessible, labelled tour control on student routes', () => {
    isRunning = false;
    renderAt('/student');
    const button = screen.getByRole('button', { name: /take tour/i });
    expect(button).toBeInTheDocument();
    // Label is visible text, not just an icon.
    expect(button).toHaveTextContent('Take Tour');
  });

  it('is hidden off student routes', () => {
    isRunning = false;
    renderAt('/instructor');
    expect(screen.queryByRole('button', { name: /tour/i })).not.toBeInTheDocument();
  });

  it('starts the suggested tour when clicked', () => {
    isRunning = false;
    renderAt('/student');
    fireEvent.click(screen.getByRole('button', { name: /take tour/i }));
    expect(startSuggestedTour).toHaveBeenCalledTimes(1);
    expect(stopTour).not.toHaveBeenCalled();
  });

  it('stops the tour when already running', () => {
    isRunning = true;
    renderAt('/student');
    fireEvent.click(screen.getByRole('button', { name: /stop tour/i }));
    expect(stopTour).toHaveBeenCalledTimes(1);
  });
});
