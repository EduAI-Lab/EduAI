import { ReactNode, useEffect } from 'react';
import { PageLoader } from '@eduai/ui';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessQm } from '@/lib/rbac/roles';
import { AccessDeniedView } from '@/components/auth/AccessDeniedView';
import { getCoreUrl } from '@/lib/coreUrl';
import { QmAccessShell } from '@/components/layout/QmAppLayout';

type QmAppGateProps = {
  children: ReactNode;
};

export function QmAppGate({ children }: QmAppGateProps) {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      const coreUrl = getCoreUrl();
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `${coreUrl}/login?redirect=${returnUrl}`;
    }
  }, [isLoading, user]);

  if (isLoading || !user) {
    return <PageLoader />;
  }

  if (!canAccessQm(user.role)) {
    return (
      <QmAccessShell>
        <AccessDeniedView />
      </QmAccessShell>
    );
  }

  return <>{children}</>;
}
