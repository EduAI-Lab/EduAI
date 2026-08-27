/**
 * Unit tests for CourseCanvasTab (#1544): loading skeleton, disconnected empty
 * state, and connected panels (connection info, course link, import action).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { canvasService } = vi.hoisted(() => ({
  canvasService: { getIntegration: vi.fn(), getCourseMapping: vi.fn() },
}));

vi.mock('@/services/canvasService', () => ({ canvasService }));

import { CourseCanvasTab } from '@/pages/course-detail/CourseCanvasTab';

afterEach(cleanup);

function renderTab(props: Partial<React.ComponentProps<typeof CourseCanvasTab>> = {}) {
  return render(
    <MemoryRouter>
      <CourseCanvasTab
        courseId={1}
        canWrite
        onImportFromCanvas={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('CourseCanvasTab', () => {
  it('shows a not-connected empty state when Canvas is not connected', async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    canvasService.getCourseMapping.mockResolvedValue(null);
    renderTab();
    await waitFor(() => expect(screen.getByText("Canvas isn't connected")).toBeInTheDocument());
  });

  it('shows connection and course-link panels when connected', async () => {
    canvasService.getIntegration.mockResolvedValue({
      isConnected: true,
      isTestMode: false,
      canvasUrl: 'https://canvas.example.edu',
    });
    canvasService.getCourseMapping.mockResolvedValue({ coreCourseId: 42 });
    renderTab();
    await waitFor(() => expect(screen.getByText('https://canvas.example.edu')).toBeInTheDocument());
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/linked to Canvas course #42/)).toBeInTheDocument();
  });

  it('shows test mode badge and unlinked message when not test mode is true and no mapping', async () => {
    canvasService.getIntegration.mockResolvedValue({
      isConnected: true,
      isTestMode: true,
      canvasUrl: 'https://canvas.example.edu',
    });
    canvasService.getCourseMapping.mockResolvedValue(null);
    renderTab();
    await waitFor(() => expect(screen.getByText('Test mode')).toBeInTheDocument());
    expect(screen.getByText(/No Canvas course linked yet/)).toBeInTheDocument();
  });

  it('invokes onImportFromCanvas when the import button is clicked', async () => {
    const onImportFromCanvas = vi.fn();
    canvasService.getIntegration.mockResolvedValue({ isConnected: true, isTestMode: false });
    canvasService.getCourseMapping.mockResolvedValue(null);
    renderTab({ onImportFromCanvas });
    await waitFor(() => expect(screen.getByText('Import from Canvas')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Import from Canvas'));
    expect(onImportFromCanvas).toHaveBeenCalled();
  });

  it('disables the import button when canWrite is false', async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true, isTestMode: false });
    canvasService.getCourseMapping.mockResolvedValue(null);
    renderTab({ canWrite: false });
    await waitFor(() =>
      expect(screen.getByText('Import from Canvas').closest('button')).toBeDisabled(),
    );
  });
});
