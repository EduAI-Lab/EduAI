import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BugReportProvider } from '~/components/bug-report/BugReportProvider';
import { useBugReport } from '~/components/bug-report/useBugReport';

const { captureScreenshotMock, getCapturedDataMock } = vi.hoisted(() => ({
  captureScreenshotMock: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
  getCapturedDataMock: vi.fn().mockReturnValue({
    consoleLogs: '[]',
    networkLogs: '[]',
    screenshot: null,
  }),
}));

vi.mock('~/hooks/useBugReportCapture', () => ({
  useBugReportCapture: () => ({
    captureScreenshot: captureScreenshotMock,
    getCapturedData: getCapturedDataMock,
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <BugReportProvider>{children}</BugReportProvider>;
}

describe('BugReportProvider', () => {
  it('exposes default null context and allows updates', () => {
    const { result } = renderHook(() => useBugReport(), { wrapper: Wrapper });

    expect(result.current.context).toEqual({
      courseOfferingId: null,
      moduleId: null,
      lessonId: null,
      activityId: null,
    });

    act(() => {
      result.current.setContext({
        courseOfferingId: 10,
        moduleId: 20,
        lessonId: 30,
        activityId: 40,
      });
    });

    expect(result.current.context).toEqual({
      courseOfferingId: 10,
      moduleId: 20,
      lessonId: 30,
      activityId: 40,
    });

    act(() => {
      result.current.clearContext();
    });

    expect(result.current.context).toEqual({
      courseOfferingId: null,
      moduleId: null,
      lessonId: null,
      activityId: null,
    });
  });

  it('forwards capture helpers from useBugReportCapture', async () => {
    const { result } = renderHook(() => useBugReport(), { wrapper: Wrapper });

    await result.current.captureScreenshot();
    result.current.getCapturedData();

    expect(captureScreenshotMock).toHaveBeenCalledTimes(1);
    expect(getCapturedDataMock).toHaveBeenCalledTimes(1);
  });
});
