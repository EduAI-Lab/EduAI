import { ReactNode } from 'react';

type PermissionGateProps = {
  allow: boolean;
  children: ReactNode;
  fallback?: ReactNode;
};

/** Declarative wrapper — hide UI when the user lacks permission. */
export function PermissionGate({ allow, children, fallback = null }: PermissionGateProps) {
  if (!allow) return <>{fallback}</>;
  return <>{children}</>;
}
