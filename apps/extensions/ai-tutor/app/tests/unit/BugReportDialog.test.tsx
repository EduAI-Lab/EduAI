import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BugReportDialog } from '~/components/bug-report/BugReportDialog';

const { submitBugReportMock, captureScreenshotMock, getCapturedDataMock } = vi.hoisted(() => {
  return {
    submitBugReportMock: vi.fn(),
    captureScreenshotMock: vi.fn().mockResolvedValue('data:image/png;base64,new'),
    getCapturedDataMock: vi.fn().mockReturnValue({
      consoleLogs: '[{"level":"error","message":"boom"}]',
      networkLogs: '[{"method":"GET","url":"/api"}]',
      screenshot: 'data:image/png;base64,abc',
    }),
  };
});

vi.mock('~/lib/api', () => ({
  default: {
    submitBugReport: submitBugReportMock,
  },
}));

vi.mock('~/components/bug-report/useBugReport', () => ({
  useBugReport: () => ({
    context: {
      courseOfferingId: 12,
      moduleId: 34,
      lessonId: 56,
      activityId: 78,
    },
    captureScreenshot: captureScreenshotMock,
    getCapturedData: getCapturedDataMock,
  }),
}));

describe('BugReportDialog', () => {
  beforeEach(() => {
    submitBugReportMock.mockReset();
    captureScreenshotMock.mockClear();
    getCapturedDataMock.mockClear();
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost:5173/student/lesson/56' },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'vitest-agent',
      configurable: true,
    });
  });

  it('validates description length before submit', async () => {
    render(<BugReportDialog open={true} setOpen={vi.fn()} />);

    fireEvent.change(screen.getByTestId('bug-description'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    expect(await screen.findByText('Please provide at least 10 characters')).toBeInTheDocument();
    expect(submitBugReportMock).not.toHaveBeenCalled();
  });

  it('captures screenshot on open and submits full payload including anonymous/context', async () => {
    submitBugReportMock.mockResolvedValue({ id: 'bug-1' });
    const setOpen = vi.fn();
    render(<BugReportDialog open={true} setOpen={setOpen} />);

    await waitFor(() => {
      expect(captureScreenshotMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByTestId('bug-description'), {
      target: { value: 'This is a reproducible issue in lesson view.' },
    });
    fireEvent.click(screen.getByRole('switch', { name: /submit anonymously/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => {
      expect(submitBugReportMock).toHaveBeenCalledTimes(1);
    });

    expect(submitBugReportMock).toHaveBeenCalledWith({
      description: 'This is a reproducible issue in lesson view.',
      isAnonymous: true,
      consoleLogs: '[{"level":"error","message":"boom"}]',
      networkLogs: '[{"method":"GET","url":"/api"}]',
      screenshot: 'data:image/png;base64,abc',
      pageUrl: 'http://localhost:5173/student/lesson/56',
      userAgent: 'vitest-agent',
      context: {
        courseOfferingId: 12,
        moduleId: 34,
        lessonId: 56,
        activityId: 78,
      },
    });
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('bug-description')).toHaveValue('');
  });
});
