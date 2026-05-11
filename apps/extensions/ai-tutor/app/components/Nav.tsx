/**
 * @file Sticky top-nav header rendered on every authenticated page.
 *
 * Responsibility: Displays the brand mark, role-aware section links, the
 *   EduAI connectivity badge, the user identity chip, and the bug-report /
 *   sign-out actions. Also owns the `BugReportDialog` mount because the
 *   pre-dialog screenshot must be taken BEFORE the modal opens.
 * Used by: `app/root.tsx` (rendered globally for logged-in routes).
 * Gotchas:
 *   - Admin users skip the EduAI probe entirely. The admin-isolation
 *     middleware blocks them from `/api/ai-models*`, so calling it would
 *     produce a noisy 403 and a misleading red "disconnected" badge.
 *     We hard-code "connected" for admins because the probe wouldn't tell
 *     them anything useful anyway (admins don't run the chat features).
 *   - The bug-report flow captures the screenshot in this component (not
 *     in `BugReportDialog`) so the dialog itself is not part of the capture.
 *     Opening the dialog before the capture would leak the modal chrome
 *     into every report.
 *   - `canReportBug` is gated to STUDENT/PROFESSOR; admins use a different
 *     triage surface.
 * Related: `app/components/bug-report/BugReportDialog.tsx`,
 *   `app/components/bug-report/useBugReport.ts`, `app/hooks/useLocalUser.tsx`
 */

import { Link, useLocation, useNavigate } from 'react-router';
import { useLocalUser } from '../hooks/useLocalUser';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import TourButton from './TourButton';
import { BugReportDialog } from './bug-report/BugReportDialog';
import { useBugReport } from './bug-report/useBugReport';

/**
 * Top-of-page navigation header. Self-contained: pulls auth from
 * `useLocalUser()` and routing context from React Router; no props.
 */
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
  const isAdminUser = user?.role === 'ADMIN';
  const canReportBug = user?.role === 'STUDENT' || user?.role === 'PROFESSOR';

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

  useEffect(() => {
    if (isAdminUser) {
      // Admins are intentionally scoped away from non-admin endpoints,
      // so skip the shared live-model probe that would otherwise 403.
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
    <header className="sticky top-0 z-50 w-full">
      {/* Glass navbar */}
      <div className="panel-glass border-b border-border/50">
        <div className="container mx-auto px-6">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link
              to="/"
              className="group flex items-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {/* Logo mark - abstract book/graduation cap hybrid */}
              <div className="relative flex h-10 w-10 items-center justify-center">
                <div className="absolute inset-0 rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/15" />
                <div className="relative flex flex-col items-center gap-0.5">
                  <div className="h-1 w-5 rounded-full bg-primary" />
                  <div className="h-1 w-4 rounded-full bg-primary/70" />
                  <div className="h-1 w-3 rounded-full bg-primary/40" />
                </div>
              </div>

              {/* Wordmark */}
              <div className="flex flex-col">
                <span className="font-display text-lg font-bold tracking-tight text-foreground">
                  AI Tutor
                </span>
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Learn smarter
                </span>
              </div>
            </Link>

            {/* Navigation */}
            <nav className="flex items-center gap-2">
              {/* Context nav links */}
              {isStudent && (
                <Link to="/student" className="btn-ghost text-sm">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                  My Courses
                </Link>
              )}

              <TourButton />

              {isInstructor && (
                <Link to="/instructor" className="btn-ghost text-sm">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  Teaching
                </Link>
              )}

              {isAdmin && (
                <Link to="/admin" className="btn-ghost text-sm">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 11-3 0M10.5 18h9.75m-9.75 0a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 11-3 0m3-6h9.75m-9.75 0a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 11-3 0"
                    />
                  </svg>
                  Admin
                </Link>
              )}

              {/* User info & logout */}
              {user && (
                <div className="flex items-center gap-3 pl-2 ml-2 border-l border-border">
                  {/* EduAI Status Badge */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium cursor-default ${
                          eduAiStatus === 'loading'
                            ? 'bg-muted text-muted-foreground'
                            : eduAiStatus === 'connected'
                              ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                              : 'bg-red-500/15 text-red-600 dark:text-red-400'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            eduAiStatus === 'loading'
                              ? 'bg-muted-foreground animate-pulse'
                              : eduAiStatus === 'connected'
                                ? 'bg-green-500'
                                : 'bg-red-500'
                          }`}
                        />
                        <span className="hidden sm:inline">EduAI</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {eduAiStatus === 'loading'
                        ? 'Checking EduAI connection...'
                        : eduAiStatus === 'connected'
                          ? 'EduAI is connected'
                          : 'EduAI is not connected'}
                    </TooltipContent>
                  </Tooltip>

                  {/* User badge */}
                  <div className="hidden md:flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase text-secondary-foreground">
                      {user.name?.charAt(0) || 'U'}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground leading-tight">
                        {user.name}
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {user.role}
                      </span>
                    </div>
                  </div>

                  {/* Logout button */}
                  {canReportBug && (
                    <button
                      type="button"
                      onClick={handleOpenBugReport}
                      className="btn-ghost text-sm"
                      disabled={capturingScreenshot}
                    >
                      {capturingScreenshot ? 'Preparing...' : 'Report Bug'}
                    </button>
                  )}

                  <button
                    onClick={handleLogout}
                    className="btn-ghost text-sm text-muted-foreground hover:text-destructive"
                    title="Sign out"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                      />
                    </svg>
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                </div>
              )}
            </nav>
          </div>
        </div>
      </div>
      <BugReportDialog open={bugReportOpen} setOpen={setBugReportOpen} />
    </header>
  );
}
