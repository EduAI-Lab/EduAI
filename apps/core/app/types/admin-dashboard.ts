import type { DashboardCourse } from "~/components/dashboard/dashboard-view";
import type { UserRoleBreakdown } from "~/types/dashboard";

/** Badge severity for an attention row with a non-zero count; a zero is always "success". */
export type AttentionSeverity = "warning" | "destructive";

export interface AdminAttentionItem {
  id:
    | "unit-admins-without-units"
    | "failed-materials"
    | "failed-cron-jobs"
    | "unhandled-bug-reports"
    | "pending-invitations"
    | "never-signed-in"
    | "courses-without-instructor";
  title: string;
  description: string;
  count: number;
  severity: AttentionSeverity;
  href: string;
}

/**
 * "degraded" is only reported for UBC models: the fleet is up but strained, which
 * is neither OK nor Failed.
 */
export type AdminHealthStatus = "ok" | "failed" | "degraded" | "not-set";

export interface AdminHealthItem {
  id: string;
  kind: "cron" | "ai";
  name: string;
  status: AdminHealthStatus;
  /** Plain-language detail, e.g. "No provider key set". */
  detail: string | null;
  /** ISO time of the last run or check, rendered as "x ago" by the client. */
  lastRunAt: string | null;
}

export interface AdminActivityEntry {
  id: string;
  actionCode: string;
  entityLabel: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface AdminWeeklyChats {
  /** ISO date (YYYY-MM-DD) of the Monday the week starts on, UTC. */
  weekStart: string;
  count: number;
}

export interface AdminDashboardData {
  users: { total: number; byRole: UserRoleBreakdown };
  courses: { total: number; published: number };
  materials: { total: number; ready: number };
  aiSessions: { total: number; thisWeek: number };
  attention: AdminAttentionItem[];
  health: AdminHealthItem[];
  weeklyChats: AdminWeeklyChats[];
  courseList: DashboardCourse[];
  recentActivity: AdminActivityEntry[];
}
