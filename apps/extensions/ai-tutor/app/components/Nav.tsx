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
  IconExternalLink,
  IconLogout,
  IconMoon,
  IconSettings,
  IconSun,
} from '@tabler/icons-react';
import { Avatar, Button, RoleBadge, Separator, Tooltip, TooltipContent, TooltipTrigger } from '@eduai/ui';

import { useLocalUser } from '../hooks/useLocalUser';
import { api } from '../lib/api';
import { getEduAiAppUrl } from '../lib/extension-urls';
import TourButton from './TourButton';
import { BugReportDialog } from './bug-report/BugReportDialog';
import { useBugReport } from './bug-report/useBugReport';

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
      <div className="container mx-auto flex h-[var(--header-height)] items-center justify-between gap-4 px-4 lg:px-6">
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
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Button variant="outline" size="sm" asChild className="hidden md:inline-flex">
              <a href={eduAiUrl} aria-label="Open EduAI Core">
                <IconExternalLink className="h-4 w-4" />
                <span className="hidden lg:inline">EduAI Core</span>
              </a>
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`hidden items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium sm:flex ${
                    eduAiStatus === 'loading'
                      ? 'bg-muted text-muted-foreground'
                      : eduAiStatus === 'connected'
                        ? 'bg-[var(--color-success-100)] text-[var(--color-success-700)]'
                        : 'bg-[var(--color-error-100)] text-[var(--color-error-700)]'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      eduAiStatus === 'loading'
                        ? 'animate-pulse bg-muted-foreground'
                        : eduAiStatus === 'connected'
                          ? 'bg-[var(--color-success-500)]'
                          : 'bg-[var(--color-error-500)]'
                    }`}
                  />
                  EduAI
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {eduAiStatus === 'loading'
                  ? 'Checking EduAI connection…'
                  : eduAiStatus === 'connected'
                    ? 'EduAI is connected'
                    : 'EduAI is not connected'}
              </TooltipContent>
            </Tooltip>

            <div className="hidden items-center gap-2 md:flex">
              <Avatar name={user.name ?? 'User'} size={32} />
              <div className="flex flex-col">
                <span className="max-w-[120px] truncate text-sm font-medium leading-tight">
                  {user.name}
                </span>
                <RoleBadge role={user.role} className="mt-0.5 w-fit" />
              </div>
            </div>

            {canReportBug && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleOpenBugReport}
                disabled={capturingScreenshot}
              >
                {capturingScreenshot ? 'Preparing…' : 'Report Bug'}
              </Button>
            )}

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

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              aria-label="Sign out"
              className="text-muted-foreground hover:text-destructive"
            >
              <IconLogout className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        )}
      </div>
      <BugReportDialog open={bugReportOpen} setOpen={setBugReportOpen} />
    </header>
  );
}
