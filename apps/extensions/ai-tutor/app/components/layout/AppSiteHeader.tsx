import { useState } from 'react';
import { useTheme } from '@eduai/ui';
import { IconBug, IconMoon, IconSun } from '@tabler/icons-react';
import { Button, Separator, SidebarTrigger } from '@eduai/ui';

import { useLocalUser } from '~/hooks/useLocalUser';
import { BugReportDialog } from '../bug-report/BugReportDialog';
import { useBugReport } from '../bug-report/useBugReport';

export type AppSiteHeaderProps = {
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
};

/**
 * Top header aligned with EduAI Core `site-header.tsx`:
 * theme toggle and bug report live in the header; EduAI Core link and account live in the sidebar.
 */
export function AppSiteHeader({ breadcrumbs, actions }: AppSiteHeaderProps) {
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const { user } = useLocalUser();
  const { captureScreenshot } = useBugReport();
  const { resolvedTheme, setTheme } = useTheme();
  const canReportBug = Boolean(user);

  const handleOpenBugReport = async () => {
    setCapturingScreenshot(true);
    try {
      await captureScreenshot();
      setBugReportOpen(true);
    } finally {
      setCapturingScreenshot(false);
    }
  };

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <>
      <header className="sticky top-0 z-20 flex h-[var(--header-height)] shrink-0 items-center border-b bg-background">
        <div className="flex h-full w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
          {breadcrumbs ? (
            <div
              className="min-w-0 flex-1 overflow-hidden"
              style={{
                maskImage: 'linear-gradient(to right, black calc(100% - 3rem), transparent)',
              }}
            >
              {breadcrumbs}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="ml-auto flex h-full shrink-0 items-center gap-3 sm:gap-4">
            {actions}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {resolvedTheme === 'dark' ? (
                <IconSun size={18} aria-hidden="true" />
              ) : (
                <IconMoon size={18} aria-hidden="true" />
              )}
            </button>
            {canReportBug ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleOpenBugReport()}
                disabled={capturingScreenshot}
                className="shrink-0"
              >
                <IconBug className="mr-1 h-4 w-4" aria-hidden="true" />
                {capturingScreenshot ? 'Preparing…' : 'Report bug'}
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <BugReportDialog open={bugReportOpen} setOpen={setBugReportOpen} />
    </>
  );
}
