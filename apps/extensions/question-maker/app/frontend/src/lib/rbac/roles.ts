// Core represents course TAs as platform STUDENT users; course-level guards
// still deny ordinary students who do not hold a TA enrollment.
export const QM_AUTHORIZED_ROLES = ["INSTRUCTOR", "ADMIN", "UNIT_ADMIN", "STUDENT"] as const;

export type QmAuthorizedRole = (typeof QM_AUTHORIZED_ROLES)[number];

export function canAccessQm(role: string | undefined | null): boolean {
  if (!role) return false;
  return (QM_AUTHORIZED_ROLES as readonly string[]).includes(role);
}
