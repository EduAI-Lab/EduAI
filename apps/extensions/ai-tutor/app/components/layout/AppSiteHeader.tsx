import { useEffect, useState } from 'react';
import { useTheme } from '@eduai/ui';
import { IconExternalLink, IconMoon, IconSun } from '@tabler/icons-react';
import {
  Button,
  Separator,
  SidebarTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@eduai/ui';

import { useLocalUser } from '~/hooks/useLocalUser';
import { useAtPermissions } from '~/hooks/useAtPermissions';
import { api } from '~/lib/api';
import { getEduAiAppUrl } from '~/lib/extension-urls';
import { BugReportDialog } from '../bug-report/BugReportDialog';
import { useBugReport } from '../bug-report/useBugReport';

function EduAiConnectionDot({
  status,
}: {
  status: 'loading' | 'connected' | 'disconnected';
}) {
  const label =
    status === 'loading'
      ? 'Checking EduAI connection…'
      : status === 'connected'
        ? 'EduAI is connected'
        : 'EduAI is not connected';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-md"
          aria-label={label}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              status === 'loading'
                ? 'animate-pulse bg-muted-foreground'
                : status === 'connected'
                  ? 'bg-[var(--color-success-500)]'
                  : 'bg-[var(--color-error-500)]'
            }`}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export type AppSiteHeaderProps = {
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
};

/**
 * Top header aligned with EduAI Core `site-header.tsx`:
 * theme toggle and bug report live in the header; account/sign-out live in the sidebar footer.
 */
export function AppSiteHeader({ breadcrumbs, actions }: AppSiteHeaderProps) {
  const [eduAiStatus, setEduAiStatus] = useState<'loading' | 'connected' | 'disconnected'>(
    'loading',
  );
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const { user } = useLocalUser();
  const { canSubmitBugReport } = useAtPermissions();
  const { captureScreenshot } = useBugReport();
  const { resolvedTheme, setTheme } = useTheme();
  const eduAiUrl = getEduAiAppUrl();
  const isAdminUser = user?.role === 'ADMIN';
  const canReportBug = canSubmitBugReport;

  useEffect(() => {
    if (isAdminUser) {
      setEduAiStatus('connected');
      return;
    }

    let mounted = true;
    api
      .listAiModels()
      .then(() => {
        if (mounted) setEduAiStatus('connected');
      })
      .catch(() => {
        if (mounted) setEduAiStatus('disconnected');
      });
    return () => {
      mounted = false;
    };
  }, [isAdminUser]);

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
          <div className="ml-auto flex h-full items-center gap-3 sm:gap-4">
            {actions}
            <div className="hidden items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-1 py-0.5 sm:flex">
              <Button variant="ghost" size="sm" asChild className="h-8 shadow-none">
                <a href={eduAiUrl} aria-label="Open EduAI Core">
                  <IconExternalLink className="h-4 w-4" />
                  <span className="hidden lg:inline">EduAI Core</span>
                </a>
              </Button>
              <Separator orientation="vertical" className="h-4" />
              <EduAiConnectionDot status={eduAiStatus} />
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                variant="ghost"
                size="sm"
                onClick={() => void handleOpenBugReport()}
                disabled={capturingScreenshot}
              >
                {capturingScreenshot ? 'Preparing…' : 'Report Bug'}
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <BugReportDialog open={bugReportOpen} setOpen={setBugReportOpen} />
    </>
  );
}
