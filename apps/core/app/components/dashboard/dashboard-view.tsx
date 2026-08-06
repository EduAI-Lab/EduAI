import { lazy, Suspense, useState } from "react";
import { Spinner } from "@eduai/ui";
import { Link, useNavigate } from "react-router";
import {
  IconMessageCircle,
  IconChevronRight,
  IconBook,
  IconUser,
} from "@tabler/icons-react";

import {
  StatCard,
  COURSE_COLORS,
  QuickActionsPanel,
  type QuickAction,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@eduai/ui";
import { termLabel } from "@eduai/ui";
import { ScrollReveal } from "~/components/motion/scroll-reveal";
import { fetchChatTranscript, type ChatTranscript } from "~/hooks/api/use-chat-history";

// Only ever rendered inside the transcript dialog, and it pulls the heavy
// chat-message chunk (streamdown + shiki). Load it on open so the dashboard's
// initial bundle doesn't carry it (#1223).
const ChatTranscriptViewer = lazy(() =>
  import("~/components/chat/chat-transcript-viewer").then((m) => ({
    default: m.ChatTranscriptViewer,
  })),
);

// ── Types ──────────────────────────────────────────────────────────────────

export type DashboardStatDef = {
  label: string;
  value: string | number;
  /** Numeric percentage trend (positive = up, negative = down) */
  trend?: number;
  trendLabel?: string;
};

/** @deprecated Use `QuickAction` from `@eduai/ui`. Kept as an alias for existing role-view imports. */
export type DashboardQuickAction = QuickAction;

export type DashboardCourse = {
  id: string;
  code: string;
  name: string;
  term: string;
  year: number;
};

export type DashboardRecentChat = {
  id: string;
  title: string | null;
  preview: string | null;
  courseCode: string | null;
  courseName: string | null;
  userName: string | null;
  updatedAt: string;
};

export type DashboardViewProps = {
  stats: DashboardStatDef[];
  /** For non-admin roles — shows course list on the left panel */
  courses?: DashboardCourse[];
  /** coursesLoading shown while courses fetch resolves */
  coursesLoading?: boolean;
  /** For admin role — shows quick-action cards on the left panel */
  quickActions?: DashboardQuickAction[];
  /** Section title for left panel (defaults by role) */
  leftPanelTitle?: string;
  recentChats: DashboardRecentChat[];
  recentChatsLoading?: boolean;
  /** Optional analytics row (charts) rendered full-width below the stat cards. */
  analytics?: React.ReactNode;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CourseListPanel({
  courses,
  loading,
  title,
}: {
  courses: DashboardCourse[];
  loading: boolean;
  title: string;
}) {
  const navigate = useNavigate();
  if (loading) {
    return (
      <div className="rounded-[var(--radius-xl)] border border-border overflow-hidden shadow-[var(--shadow-2xs)] bg-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-b-0 animate-pulse">
            <div className="w-1 h-11 rounded-sm bg-muted flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-muted rounded w-24" />
              <div className="h-3 bg-muted rounded w-48" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)] px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">No courses found.</p>
        <Link to="/courses" className="mt-2 inline-block text-xs font-medium text-primary-text hover:underline">
          Browse courses →
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-xl)] border border-border overflow-hidden shadow-[var(--shadow-2xs)] bg-card">
      {courses.slice(0, 5).map((course, i) => (
        <Link
          key={course.id}
          to={`/courses/${course.id}`}
          className="flex items-center gap-4 px-5 py-[14px] border-b border-border last:border-b-0 hover:bg-muted/40 hover:-translate-y-px transition-all duration-200"
        >
          {/* color swatch */}
          <div
            className="w-1 h-11 rounded-sm flex-shrink-0"
            style={{ background: COURSE_COLORS[i % COURSE_COLORS.length] }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{course.code}</span>
              <span className="text-[11px] text-muted-foreground">{termLabel(course.term, course.year)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{course.name}</div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              // Nested inside the row's <Link>; a nested <a> is invalid markup
              // and hydration-mismatches, so navigate imperatively instead.
              e.preventDefault();
              e.stopPropagation();
              navigate(`/chat?courseCode=${encodeURIComponent(course.code)}`);
            }}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-white rounded-[var(--radius-md)] whitespace-nowrap"
            style={{ background: "var(--primary)" }}
          >
            Chat
          </button>
        </Link>
      ))}
    </div>
  );
}


function RecentChatsPanel({
  chats,
  loading,
}: {
  chats: DashboardRecentChat[];
  loading: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedChat, setSelectedChat] = useState<DashboardRecentChat | null>(null);
  const [transcript, setTranscript] = useState<ChatTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const handleOpen = async (chat: DashboardRecentChat) => {
    setSelectedChat(chat);
    setDialogOpen(true);
    setTranscript(null);
    setTranscriptLoading(true);
    const data = await fetchChatTranscript(chat.id);
    setTranscript(data);
    setTranscriptLoading(false);
  };

  const handleClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setSelectedChat(null);
      setTranscript(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[var(--radius-xl)] border border-border overflow-hidden shadow-[var(--shadow-2xs)] bg-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="px-5 py-[14px] border-b border-border last:border-b-0 animate-pulse space-y-2">
            <div className="flex justify-between">
              <div className="h-3 bg-muted rounded w-16" />
              <div className="h-3 bg-muted rounded w-12" />
            </div>
            <div className="h-3.5 bg-muted rounded w-4/5" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="rounded-[var(--radius-xl)] border border-border overflow-hidden shadow-[var(--shadow-2xs)] bg-card h-full flex flex-col">
        {chats.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
            <IconMessageCircle size={24} className="mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No conversations yet.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => handleOpen(chat)}
                className="w-full text-left block px-5 py-[14px] border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
              >
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {chat.courseCode ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-text flex-shrink-0">
                        <IconBook size={11} />
                        {chat.courseCode}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground flex-shrink-0">
                        <IconMessageCircle size={11} />
                        General
                      </span>
                    )}
                    {chat.userName && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                        <IconUser size={10} className="flex-shrink-0" />
                        <span className="truncate">{chat.userName}</span>
                      </span>
                    )}
                  </div>
                  {/* Recent chats are SSR'd now (#1220), so this relative
                      timestamp renders on the server too; its value depends on
                      the wall clock and timezone, so suppress the expected
                      server/client hydration diff (React's canonical timestamp
                      case) rather than mismatch-warn on every dashboard load. */}
                  <span suppressHydrationWarning className="text-[11px] text-muted-foreground flex-shrink-0 ml-2">{relativeTime(chat.updatedAt)}</span>
                </div>
                <p className="text-[13px] text-foreground leading-snug line-clamp-2">
                  {chat.preview ?? chat.title ?? "New conversation"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto rounded-[var(--radius-xl)]">
          <DialogHeader>
            <DialogTitle>
              {selectedChat?.preview ?? selectedChat?.title ?? "Conversation"}
            </DialogTitle>
            <DialogDescription>
              {selectedChat?.userName ? `${selectedChat.userName}'s conversation` : "Conversation"}
              {selectedChat?.courseCode ? ` · ${selectedChat.courseCode}` : ""}
            </DialogDescription>
          </DialogHeader>
          {transcriptLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Spinner size="md" />
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Spinner size="md" />
                </div>
              }
            >
              <ChatTranscriptViewer
                messages={transcript?.messages ?? []}
                ownerName={selectedChat?.userName}
                courseCode={selectedChat?.courseCode}
                continueChatId={transcript?.canEdit ? selectedChat?.id : undefined}
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main layout component ──────────────────────────────────────────────────

export function DashboardView({
  stats,
  courses,
  coursesLoading = false,
  quickActions,
  leftPanelTitle,
  recentChats,
  recentChatsLoading = false,
  analytics,
}: DashboardViewProps) {
  const showQuickActions = Boolean(quickActions && quickActions.length > 0);
  const panelTitle = leftPanelTitle ?? (showQuickActions ? "Quick actions" : "Your courses");

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 pb-8">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s, index) => (
          <ScrollReveal key={s.label} index={index}>
            <StatCard
              label={s.label}
              value={s.value}
              trend={s.trend}
              trendLabel={s.trendLabel}
            />
          </ScrollReveal>
        ))}
      </div>

      {/* Analytics charts */}
      {analytics && (
        <ScrollReveal index={3}>
          <div data-tour="dashboard-analytics">{analytics}</div>
        </ScrollReveal>
      )}

      {/* 2-column body */}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-stretch">

        {/* Left — courses or quick actions */}
        <ScrollReveal index={4}>
        <div>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-[15px] font-semibold text-foreground">{panelTitle}</h2>
            {!showQuickActions && (
              <Link
                to="/courses"
                className="flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline"
              >
                Browse all <IconChevronRight size={13} />
              </Link>
            )}
          </div>
          {showQuickActions ? (
            <QuickActionsPanel actions={quickActions!} LinkComponent={Link} />
          ) : (
            <CourseListPanel
              courses={courses ?? []}
              loading={coursesLoading}
              title={panelTitle}
            />
          )}
        </div>
        </ScrollReveal>

        {/* Right — recent conversations */}
        <ScrollReveal index={5}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-[15px] font-semibold text-foreground">Recent conversations</h2>
            <Link
              to="/chat"
              className="flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline"
            >
              New chat <IconChevronRight size={13} />
            </Link>
          </div>
          <div className="flex-1">
            <RecentChatsPanel chats={recentChats} loading={recentChatsLoading} />
          </div>
        </div>
        </ScrollReveal>
      </div>
    </div>
  );
}
