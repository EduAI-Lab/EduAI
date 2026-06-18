import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  IconChevronDown,
  IconExternalLink,
  IconLogout,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  RoleBadge,
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

export function AppSiteHeader({ breadcrumbs, actions }: AppSiteHeaderProps) {
  const [eduAiStatus, setEduAiStatus] = useState<'loading' | 'connected' | 'disconnected'>(
    'loading',
  );
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const { user, logout } = useLocalUser();
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
          <div className="ml-auto flex h-full items-center gap-2 sm:gap-3">
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
            {canReportBug ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleOpenBugReport()}
                disabled={capturingScreenshot}
                className="hidden sm:inline-flex"
              >
                {capturingScreenshot ? 'Preparing…' : 'Report Bug'}
              </Button>
            ) : null}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Avatar name={user.name ?? 'User'} size={32} />
                    <span className="hidden max-w-[7rem] truncate text-sm font-medium xl:inline">
                      {user.name}
                    </span>
                    <IconChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground xl:block" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Avatar name={user.name ?? 'User'} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{user.name}</p>
                        <RoleBadge role={user.role} />
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {canReportBug ? (
                    <>
                      <DropdownMenuItem
                        className="sm:hidden"
                        disabled={capturingScreenshot}
                        onSelect={() => void handleOpenBugReport()}
                      >
                        {capturingScreenshot ? 'Preparing…' : 'Report Bug'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="sm:hidden" />
                    </>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                  >
                    {resolvedTheme === 'dark' ? (
                      <IconSun className="h-4 w-4" />
                    ) : (
                      <IconMoon className="h-4 w-4" />
                    )}
                    {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                    <IconLogout className="h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </header>
      <BugReportDialog open={bugReportOpen} setOpen={setBugReportOpen} />
    </>
  );
}
