/**
 * The ADMIN dashboard's rollup, `GET /api/admin/dashboard` (see the backend's
 * `adminDashboardService.js` for how each number is counted).
 */
import api from "./api";

export type AdminAttentionItem = {
  id: string;
  title: string;
  description: string;
  count: number;
  severity: "destructive" | "warning";
  href: string;
};

export type AdminHealthStatus = "ok" | "degraded" | "failed" | "not-set";

export type AdminHealthItem = {
  id: string;
  name: string;
  status: AdminHealthStatus;
  detail: string;
};

export type AdminWeeklyVersions = { weekStart: string; ai: number; manual: number };

export type AdminRecentItem = {
  id: string;
  kind: "question" | "assessment";
  label: string;
  href: string;
  by: string | null;
  updatedAt: string;
};

export type AdminDashboardData = {
  content: {
    questions: number;
    versions: number;
    drafts: number;
    reviewed: number;
    aiGenerated: number;
    shared: number;
  };
  courses: { total: number; withQuestions: number; canvasLinked: number };
  assessments: { total: number; byType: { type: string; count: number }[] };
  attention: AdminAttentionItem[];
  health: AdminHealthItem[];
  weeklyVersions: AdminWeeklyVersions[];
  recentActivity: AdminRecentItem[];
};

export const adminDashboardService = {
  async get(): Promise<AdminDashboardData> {
    const res = await api.get("/api/admin/dashboard");
    return res.data.data;
  },
};
