import { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { QmRoleBanner } from '@/components/rbac/QmRoleBanner';
import type { QmRoleView } from '@/lib/rbac';

type QmHomeShellProps = {
  children: ReactNode;
};

function roleToView(role: string | undefined): QmRoleView {
  if (role === 'ADMIN') return 'admin';
  if (role === 'UNIT_ADMIN') return 'unit-admin';
  return 'instructor';
}

/** Role-aware wrapper for the question bank / assessments workspace. */
export function QmHomeShell({ children }: QmHomeShellProps) {
  const { user } = useAuth();
  if (!user) return <>{children}</>;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <QmRoleBanner variant={roleToView(user.role)} />
      {children}
    </div>
  );
}
