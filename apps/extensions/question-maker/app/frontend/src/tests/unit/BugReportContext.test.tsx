import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const captureScreenshot = vi.hoisted(() => vi.fn());
const getCapturedData = vi.hoisted(() => vi.fn());
const submit = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useBugReportCapture', () => ({
  useBugReportCapture: () => ({ captureScreenshot, getCapturedData }),
}));
vi.mock('../../services/bugReportApi', () => ({ bugReportApi: { submit } }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@eduai/ui', () => ({
  BugReportDialog: ({ open, onSubmit }: { open: boolean; onSubmit: (data: unknown) => Promise<void> }) =>
    open ? <button onClick={() => void onSubmit({ description: 'A valid bug report', bugType: 'OTHER', isAnonymous: false })}>submit report</button> : null,
}));

import { BugReportProvider, useBugReport } from '../../contexts/BugReportContext';

function Trigger() {
  const bugReport = useBugReport();
  return <button onClick={bugReport?.openBugReport}>open report</button>;
}

function renderProvider(children: ReactNode = <Trigger />) {
  return render(<BugReportProvider>{children}</BugReportProvider>);
}

describe('BugReportProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureScreenshot.mockResolvedValue(undefined);
    getCapturedData.mockReturnValue({
      consoleLogs: '[]',
      networkLogs: '[]',
      screenshot: 'data:image/jpeg;base64/CLEAN_PAGE',
    });
    submit.mockResolvedValue(undefined);
  });

  it('opens immediately while capturing and submits the cached screenshot', async () => {
    renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'open report' }));
    expect(screen.getByRole('button', { name: 'submit report' })).toBeInTheDocument();

    expect(captureScreenshot).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'submit report' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      screenshot: 'data:image/jpeg;base64/CLEAN_PAGE',
      consoleLogs: '[]',
      networkLogs: '[]',
    }));
    expect(captureScreenshot).toHaveBeenCalledTimes(1);
  });
});
