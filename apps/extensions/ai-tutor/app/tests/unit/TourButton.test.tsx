import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SidebarProvider } from '@eduai/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '~/hooks/useLocalUser';
import TourButton from '~/components/TourButton';

const startSuggestedTour = vi.fn();
const stopTour = vi.fn();
let isRunning = false;
let mockUser: AuthUser | null = { id: '1', name: 'Student', role: 'STUDENT' };

vi.mock('~/components/TourProvider', () => ({
  useAppTour: () => ({ isRunning, startSuggestedTour, stopTour }),
}));

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: mockUser }),
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an accessible, labelled tour control on student routes', () => {
    isRunning = false;
    mockUser = { id: '1', name: 'Student', role: 'STUDENT' };
    renderAt('/student');
    const button = screen.getByRole('button', { name: /take tour/i });
    expect(button).toBeInTheDocument();
    // Label is visible text, not just an icon.
    expect(button).toHaveTextContent('Take Tour');
  });

  it('renders for TAs on the instructor shell', () => {
    isRunning = false;
    mockUser = { id: '2', name: 'Alex Patel', role: 'TA' };
    renderAt('/instructor');
    expect(screen.getByRole('button', { name: /take tour/i })).toBeInTheDocument();
  });

  it('is hidden for instructors on the instructor shell', () => {
    isRunning = false;
    mockUser = { id: '3', name: 'Instructor', role: 'INSTRUCTOR' };
    renderAt('/instructor');
    expect(screen.queryByRole('button', { name: /tour/i })).not.toBeInTheDocument();
  });

  it('starts the suggested tour when clicked', () => {
    isRunning = false;
    mockUser = { id: '1', name: 'Student', role: 'STUDENT' };
    renderAt('/student');
    fireEvent.click(screen.getByRole('button', { name: /take tour/i }));
    expect(startSuggestedTour).toHaveBeenCalledTimes(1);
    expect(stopTour).not.toHaveBeenCalled();
  });

  it('stops the tour when already running', () => {
    isRunning = true;
    mockUser = { id: '1', name: 'Student', role: 'STUDENT' };
    renderAt('/student');
    fireEvent.click(screen.getByRole('button', { name: /stop tour/i }));
    expect(stopTour).toHaveBeenCalledTimes(1);
  });
});
