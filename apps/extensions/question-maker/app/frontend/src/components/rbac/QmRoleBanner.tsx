import { Shield, Building2, GraduationCap } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getRoleViewLabel, type QmRoleView } from '@/lib/rbac';

type QmRoleBannerProps = {
  variant?: QmRoleView;
};

const COPY: Record<
  QmRoleView,
  { title: string; description: string; icon: typeof Shield }
> = {
  admin: {
    title: 'Administrator view',
    description:
      'Full platform access across all courses. You can manage questions, assessments, and Canvas exports. Triage bug reports in EduAI Core.',
    icon: Shield,
  },
  'unit-admin': {
    title: 'Unit administrator view',
    description:
      'Author and review content for courses in your authorized units. Actions outside your units are blocked by the server.',
    icon: Building2,
  },
  instructor: {
    title: 'Instructor view',
    description:
      'Manage your linked courses: build the question bank, approve variants, assemble assessments, and export to Canvas.',
    icon: GraduationCap,
  },
};

function roleToView(role: string | undefined): QmRoleView {
  if (role === 'ADMIN') return 'admin';
  if (role === 'UNIT_ADMIN') return 'unit-admin';
  return 'instructor';
}

export function QmRoleBanner({ variant }: QmRoleBannerProps) {
  const { user } = useAuth();
  if (!user) return null;

  const view = variant ?? roleToView(user.role);
  const copy = COPY[view];
  const Icon = copy.icon;
  const units =
    view === 'unit-admin' && user.authorizedUnits?.length
      ? user.authorizedUnits.join(', ')
      : null;

  return (
    <div
      className="rounded-lg border border-border bg-muted/40 px-4 py-3"
      data-testid={`qm-role-banner-${view}`}
    >
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{copy.title}</p>
          <p className="text-sm text-muted-foreground">{copy.description}</p>
          {units && (
            <p className="text-xs text-muted-foreground">
              Authorized units: <span className="font-medium text-foreground">{units}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Signed in as {getRoleViewLabel(user.role)}
            {user.email ? ` · ${user.email}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
