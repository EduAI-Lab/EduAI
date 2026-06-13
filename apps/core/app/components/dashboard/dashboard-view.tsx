import { Link } from "react-router";
import {
  IconArrowRight,
  IconMessageCircle,
  IconChevronRight,
} from "@tabler/icons-react";

import { StatCard, COURSE_COLORS } from "@eduai/ui";

// ── Types ──────────────────────────────────────────────────────────────────

export type DashboardStatDef = {
  label: string;
  value: string | number;
  /** Numeric percentage trend (positive = up, negative = down) */
  trend?: number;
  trendLabel?: string;
};

export type DashboardQuickAction = {
  label: string;
  description: string;
  href: string;
  /** Color used for the icon background swatch (CSS value) */
  color: string;
  icon: React.ReactNode;
};

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
        <Link to="/courses" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
          Browse courses →
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-xl)] border border-border overflow-hidden shadow-[var(--shadow-2xs)] bg-card">
      {courses.slice(0, 5).map((course, i) => (
        <div
          key={course.id}
          className="flex items-center gap-4 px-5 py-[14px] border-b border-border last:border-b-0"
        >
          {/* color swatch */}
          <div
            className="w-1 h-11 rounded-sm flex-shrink-0"
            style={{ background: COURSE_COLORS[i % COURSE_COLORS.length] }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{course.code}</span>
              <span className="text-[11px] text-muted-foreground">{course.term} {course.year}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{course.name}</div>
          </div>
          <Link
            to="/chat"
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-white rounded-[var(--radius-md)] whitespace-nowrap"
            style={{ background: "var(--primary)" }}
          >
            Chat
          </Link>
        </div>
      ))}
    </div>
  );
}

function QuickActionsPanel({ actions }: { actions: DashboardQuickAction[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map((action) => (
        <Link
          key={action.href + action.label}
          to={action.href}
          className="flex items-start gap-3 p-4 bg-card border border-border rounded-[var(--radius-xl)] shadow-[var(--shadow-2xs)] hover:shadow-md transition-shadow text-left"
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: action.color + "22" }}
          >
            <span style={{ color: action.color }}>{action.icon}</span>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-foreground">{action.label}</div>
            <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">{action.description}</div>
          </div>
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
    <div className="rounded-[var(--radius-xl)] border border-border overflow-hidden shadow-[var(--shadow-2xs)] bg-card h-full flex flex-col">
      {chats.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
          <IconMessageCircle size={24} className="mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No conversations yet.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {chats.map((chat, i) => (
            <Link
              key={chat.id}
              to="/chat"
              className="block px-5 py-[14px] border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
            >
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1.5">
                  <IconMessageCircle size={12} className="text-primary flex-shrink-0" />
                  <span className="text-[11px] font-semibold text-primary">Chat</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{relativeTime(chat.updatedAt)}</span>
              </div>
              <p className="text-[13px] text-foreground leading-snug line-clamp-2">
                {chat.title ?? `Conversation ${i + 1}`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
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
}: DashboardViewProps) {
  const showQuickActions = Boolean(quickActions && quickActions.length > 0);
  const panelTitle = leftPanelTitle ?? (showQuickActions ? "Quick actions" : "Your courses");

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 pb-8">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            trend={s.trend}
            trendLabel={s.trendLabel}
          />
        ))}
      </div>

      {/* 2-column body */}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-stretch">

        {/* Left — courses or quick actions */}
        <div>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-[15px] font-semibold text-foreground">{panelTitle}</h2>
            {!showQuickActions && (
              <Link
                to="/courses"
                className="flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
              >
                Browse all <IconChevronRight size={13} />
              </Link>
            )}
          </div>
          {showQuickActions ? (
            <QuickActionsPanel actions={quickActions!} />
          ) : (
            <CourseListPanel
              courses={courses ?? []}
              loading={coursesLoading}
              title={panelTitle}
            />
          )}
        </div>

        {/* Right — recent conversations */}
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-[15px] font-semibold text-foreground">Recent conversations</h2>
            <Link
              to="/chat"
              className="flex items-center gap-0.5 text-xs font-medium text-primary dark:text-secondary hover:underline"
            >
              New chat <IconChevronRight size={13} />
            </Link>
          </div>
          <div className="flex-1">
            <RecentChatsPanel chats={recentChats} loading={recentChatsLoading} />
          </div>
        </div>
      </div>
    </div>
  );
}
