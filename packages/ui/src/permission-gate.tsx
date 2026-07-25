import type { ReactNode } from "react"

export interface PermissionGateProps {
  /**
   * Already-resolved permission. RBAC helpers stay per-app (`lib/rbac` differs by
   * design), so this component takes the computed boolean rather than a role.
   */
  allow: boolean
  children: ReactNode
  fallback?: ReactNode
}

/** Declarative wrapper — hide UI when the user lacks permission. */
export function PermissionGate({ allow, children, fallback = null }: PermissionGateProps) {
  if (!allow) return <>{fallback}</>
  return <>{children}</>
}
