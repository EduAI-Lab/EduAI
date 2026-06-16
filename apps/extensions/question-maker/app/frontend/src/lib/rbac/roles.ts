export const QM_AUTHORIZED_ROLES = ['INSTRUCTOR', 'ADMIN', 'UNIT_ADMIN'] as const;

export type QmAuthorizedRole = (typeof QM_AUTHORIZED_ROLES)[number];

export function canAccessQm(role: string | undefined | null): boolean {
  if (!role) return false;
  return (QM_AUTHORIZED_ROLES as readonly string[]).includes(role);
}
