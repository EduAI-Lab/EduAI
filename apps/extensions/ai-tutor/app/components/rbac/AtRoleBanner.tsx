import { IconBuildingCommunity, IconSchool, IconShield, IconUsers } from '@tabler/icons-react';
import { RoleBadge } from '@eduai/ui';
import type { AtRoleView } from '~/lib/rbac/types';
import { getRoleViewLabel } from '~/lib/rbac/permissions';
import type { Role } from '~/lib/types';

type AtRoleBannerProps = {
  role: Role;
  authorizedUnits?: string[];
  variant?: AtRoleView;
};

const COPY: Record<
  AtRoleView,
  { title: string; description: string; icon: typeof IconShield }
> = {
  admin: {
    title: 'Administrator view',
    description:
      'System settings, enrollments across all courses, AI policy, and bug report triage.',
    icon: IconShield,
  },
  'unit-admin': {
    title: 'Unit administrator view',
    description:
      'Manage courses in your authorized units — content, publish workflow, and enrollments.',
    icon: IconBuildingCommunity,
  },
  instructor: {
    title: 'Instructor view',
    description:
      'Author modules, lessons, and activities for your assigned courses.',
    icon: IconSchool,
  },
  ta: {
    title: 'Teaching assistant view',
    description:
      'Read-only access to course content and student submissions for courses where you are assigned as TA.',
    icon: IconUsers,
  },
  student: {
    title: 'Student view',
    description: 'Work through published activities and AI tutoring in your enrolled courses.',
    icon: IconSchool,
  },
};

function roleToView(role: Role): AtRoleView {
  if (role === 'ADMIN') return 'admin';
  if (role === 'UNIT_ADMIN') return 'unit-admin';
  if (role === 'TA') return 'ta';
  if (role === 'STUDENT') return 'student';
  return 'instructor';
}

export function AtRoleBanner({ role, authorizedUnits, variant }: AtRoleBannerProps) {
  const view = variant ?? roleToView(role);
  const copy = COPY[view];
  const Icon = copy.icon;
  const units =
    view === 'unit-admin' && authorizedUnits?.length ? authorizedUnits.join(', ') : null;

  return (
    <div
      className="rounded-lg border border-border bg-muted/40 px-4 py-3"
      data-testid={`at-role-banner-${view}`}
    >
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{copy.title}</p>
            <RoleBadge role={role} />
          </div>
          <p className="text-sm text-muted-foreground">{copy.description}</p>
          {units ? (
            <p className="text-xs text-muted-foreground">
              Authorized units: <span className="font-medium text-foreground">{units}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{getRoleViewLabel(role)}</p>
        </div>
      </div>
    </div>
  );
}
