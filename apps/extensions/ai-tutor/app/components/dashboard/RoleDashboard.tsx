import type { ReactNode } from 'react';
import { PageHeading } from '@eduai/ui';
import { DashboardStatGrid, type DashboardStat } from '~/components/dashboard/DashboardStatGrid';

/**
 * Shared dashboard shell rendered identically for every role. The student
 * dashboard is the base layout; instructors and admins get the same structure
 * (optional role banner, heading, stat grid) with role-scoped stats and body.
 * Role differences live in `stats` (via `buildDashboardStats`) and `children`,
 * not in divergent per-role layouts.
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
    <div className="space-y-8">
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
