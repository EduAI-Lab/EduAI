import type { ReactNode } from 'react';
import { PageHeading } from '@eduai/ui';
import { DashboardStatGrid, type DashboardStat } from '~/components/dashboard/DashboardStatGrid';

/**
 * Shared dashboard shell rendered identically for every role. The student
 * dashboard is the base layout; instructors and admins get the same structure
 * (optional role banner, heading, stat grid) with role-scoped stats and body.
 * Role differences live in `stats` (via `buildDashboardStats`) and `children`,
 * not in divergent per-role layouts.
 *
 * Owns the page-level padding: `AppShell`'s `<main>` is intentionally
 * padding-free (some routes want edge-to-edge canvas), so every route that
 * renders through this shell gets its `px-4 lg:px-6` / vertical rhythm from
 * here — matches EduAI Core's `DashboardView` (`apps/core`) so the two apps'
 * dashboards share one page-padding convention.
 */
export type RoleDashboardProps = {
  heading: string;
  subheading: string;
  stats: DashboardStat[];
  /** Optional role banner (e.g. AtRoleBanner) rendered above the heading. */
  banner?: ReactNode;
  /** Optional accessory shown next to the heading (e.g. admin API-key source tag). */
  headingAccessory?: ReactNode;
  /** Optional data-tour id applied to the heading row (preserves guided-tour targets). */
  headingTourId?: string;
  /** Role-specific body: course grid, bug-report table, etc. */
  children?: ReactNode;
};

export function RoleDashboard({
  heading,
  subheading,
  stats,
  banner,
  headingAccessory,
  headingTourId,
  children,
}: RoleDashboardProps) {
  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      {banner}

      <div
        className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"
        data-tour={headingTourId}
      >
        <PageHeading heading={heading} subheading={subheading} />
        {headingAccessory}
      </div>

      <DashboardStatGrid stats={stats} />

      {children}
    </div>
  );
}
