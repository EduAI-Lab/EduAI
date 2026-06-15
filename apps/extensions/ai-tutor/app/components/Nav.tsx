/**
 * @file Sticky top-nav header rendered on every authenticated page.
 *
 * EduAI design-system shell: UBC Blue branding, @eduai/ui primitives,
 * dark-mode toggle, cross-app link back to EduAI Core, and stable action slots.
 */

import { Link, useLocation, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  IconBooks,
  IconChevronDown,
  IconExternalLink,
  IconLogout,
  IconMoon,
  IconSettings,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@eduai/ui';

import { useLocalUser } from '../hooks/useLocalUser';
import { api } from '../lib/api';
import { getEduAiAppUrl } from '../lib/extension-urls';
import TourButton from './TourButton';
import { BugReportDialog } from './bug-report/BugReportDialog';
import { useBugReport } from './bug-report/useBugReport';

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

export default function Nav() {
  const [eduAiStatus, setEduAiStatus] = useState<'loading' | 'connected' | 'disconnected'>(
    'loading',
  );
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const navigate = useNavigate();
  const loc = useLocation();
  const { user, logout } = useLocalUser();
  const { captureScreenshot } = useBugReport();
  const { resolvedTheme, setTheme } = useTheme();
  const isAdminUser = user?.role === 'ADMIN';
  const canReportBug = user?.role === 'STUDENT' || user?.role === 'INSTRUCTOR';
  const eduAiUrl = getEduAiAppUrl();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

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

  const isStudent = loc.pathname.startsWith('/student');
  const isInstructor = loc.pathname.startsWith('/instructor');
  const isAdmin = loc.pathname.startsWith('/admin');

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="container mx-auto flex h-[var(--header-height)] items-center justify-between gap-6 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: 'var(--primary)' }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="1.75"
                strokeLinecap="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a9 9 0 0 1 0 18" />
                <path d="M3 12h18" />
              </svg>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold tracking-tight text-foreground">AI Tutor</span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                EduAI Extension
              </span>
            </div>
          </Link>

          <Separator orientation="vertical" className="hidden h-4 sm:block" />

          <nav className="hidden items-center gap-1 sm:flex">
            {isStudent && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/student">
                  <IconBooks className="h-4 w-4" />
                  My Courses
                </Link>
              </Button>
            )}
            {isInstructor && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/instructor">
                  <IconBooks className="h-4 w-4" />
                  Teaching
                </Link>
              </Button>
            )}
            {isAdmin && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin">
                  <IconSettings className="h-4 w-4" />
                  Admin
                </Link>
              </Button>
            )}
            <TourButton />
          </nav>
        </div>

        {user && (
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Cross-app link + connection status */}
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-1 py-0.5">
              <Button variant="ghost" size="sm" asChild className="h-8 shadow-none">
                <a href={eduAiUrl} aria-label="Open EduAI Core">
                  <IconExternalLink className="h-4 w-4" />
                  <span className="hidden lg:inline">EduAI Core</span>
                </a>
              </Button>
              <Separator orientation="vertical" className="h-4" />
              <EduAiConnectionDot status={eduAiStatus} />
            </div>

            {canReportBug && (
              <>
                <Separator orientation="vertical" className="hidden h-5 sm:block" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenBugReport}
                  disabled={capturingScreenshot}
                  className="hidden sm:inline-flex"
                >
                  {capturingScreenshot ? 'Preparing…' : 'Report Bug'}
                </Button>
              </>
            )}

            <Separator orientation="vertical" className="hidden h-5 sm:block" />

            {/* Account menu — theme + sign out live here to reduce header clutter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar name={user.name ?? 'User'} size={32} />
                  <span className="hidden max-w-[7rem] truncate text-sm font-medium text-foreground xl:inline">
                    {user.name}
                  </span>
                  <IconChevronDown
                    className="hidden h-3.5 w-3.5 text-muted-foreground xl:block"
                    aria-hidden
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar name={user.name ?? 'User'} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      <div className="mt-1">
                        <RoleBadge role={user.role} />
                      </div>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {canReportBug && (
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
                )}
                <DropdownMenuItem onSelect={toggleTheme}>
                  {resolvedTheme === 'dark' ? (
                    <IconSun className="h-4 w-4" />
                  ) : (
                    <IconMoon className="h-4 w-4" />
                  )}
                  {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void handleLogout()}
                >
                  <IconLogout className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <BugReportDialog open={bugReportOpen} setOpen={setBugReportOpen} />
    </header>
  );
}
