/**
 * Dashboard analytics row — adopts the dependency-free chart primitives shared in
 * `@eduai/ui` (DonutChart / MeterBar / PanelCard) for Core ↔ QuestionMaker parity
 * (issue #764). Pure presentational: every number comes from the dashboard stats
 * loader. Panels self-hide when their series is absent, so each role only renders
 * the breakdowns it actually has data for.
 */
import { DonutChart, MeterBar, PanelCard, type DonutSegment } from "@eduai/ui";
import type { DashboardStats } from "~/types/dashboard";

/*
 * Semantic + role slots come from CSS custom properties, not literals. app.css
 * re-declares these under `.dark` for legibility on a dark background, so a
 * hardcoded oklch() would keep the light-mode hue after a theme flip — which is
 * what these donuts previously did while ai-tutor's equivalents followed along.
 */
const READY_COLOR = "var(--color-success-500)";
const PROCESSING_COLOR = "var(--color-warning-500)";
const FAILED_COLOR = "var(--color-error-500)";

const STUDENT_COLOR = "var(--color-role-student)";
const INSTRUCTOR_COLOR = "var(--color-role-instructor)";
const ADMIN_COLOR = "var(--color-role-admin)";
const OTHER_COLOR = "var(--muted-foreground)";

const ACTIVITY_COLOR = "var(--color-role-instructor)";

function AnalyticsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-52 animate-pulse rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]"
        />
      ))}
    </div>
  );
}

export function DashboardAnalytics({
  stats,
  loading = false,
}: {
  stats: DashboardStats | null;
  loading?: boolean;
}) {
  if (loading) return <AnalyticsSkeleton />;
  if (!stats) return null;

  const panels: React.ReactNode[] = [];

  // ── Material processing status ─────────────────────────────────────────────
  const mat = stats.materialsByStatus;
  if (mat) {
    const total = mat.ready + mat.processing + mat.failed;
    const segments: DonutSegment[] = [
      { label: "Ready", value: mat.ready, color: READY_COLOR },
      { label: "Processing", value: mat.processing, color: PROCESSING_COLOR },
      { label: "Failed", value: mat.failed, color: FAILED_COLOR },
    ];
    panels.push(
      <PanelCard key="materials" title="Material status">
        {total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No materials uploaded yet.
          </p>
        ) : (
          <DonutChart data={segments} centerValue={total} centerLabel="Materials" />
        )}
      </PanelCard>,
    );
  }

  // ── Platform user roles (ADMIN / UNIT_ADMIN) ───────────────────────────────
  const roles = stats.usersByRole;
  if (roles) {
    const total = roles.students + roles.instructors + roles.admins + roles.other;
    const segments: DonutSegment[] = [
      { label: "Students", value: roles.students, color: STUDENT_COLOR },
      { label: "Instructors", value: roles.instructors, color: INSTRUCTOR_COLOR },
      { label: "Admins", value: roles.admins, color: ADMIN_COLOR },
      { label: "Other", value: roles.other, color: OTHER_COLOR },
    ];
    panels.push(
      <PanelCard key="roles" title="Users by role">
        {total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <DonutChart data={segments} centerValue={total} centerLabel="Users" />
        )}
      </PanelCard>,
    );
  }

  // ── Weekly AI activity ─────────────────────────────────────────────────────
  panels.push(
    <PanelCard key="activity" title="AI activity">
      <div className="flex flex-col gap-4 pt-1">
        <MeterBar
          label="Chats this week"
          value={stats.chatCountWeek}
          total={Math.max(stats.chatCount, stats.chatCountWeek)}
          color={ACTIVITY_COLOR}
          showCount
        />
        <p className="text-xs text-muted-foreground">
          {stats.chatCount === 0
            ? "No conversations recorded yet."
            : `${stats.chatCountWeek} of ${stats.chatCount} total conversations happened in the last 7 days.`}
        </p>
      </div>
    </PanelCard>,
  );

  const cols =
    panels.length >= 3
      ? "md:grid-cols-3"
      : panels.length === 2
        ? "md:grid-cols-2"
        : "md:grid-cols-1";

  return <div className={`grid gap-4 ${cols}`}>{panels}</div>;
}
