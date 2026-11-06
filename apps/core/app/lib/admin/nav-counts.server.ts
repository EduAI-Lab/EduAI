import prisma from "~/lib/prisma.server";

/** Counts behind the Administration menu's badges; the dashboard's attention rows use the same queries. */
export type AdminNavCounts = {
  unhandledBugReports: number;
  pendingInvitations: number;
};

/** Bug reports nobody has triaged yet. */
export function countUnhandledBugReports(): Promise<number> {
  return prisma.bugReport.count({ where: { status: "UNHANDLED" } });
}

/** Invitations still waiting on the invitee; an expired one no longer counts. */
export function pendingInvitationWhere(now: Date) {
  return { status: "PENDING" as const, expiresAt: { gt: now } };
}

export async function loadAdminNavCounts(now = new Date()): Promise<AdminNavCounts> {
  const [unhandledBugReports, pendingInvitations] = await Promise.all([
    countUnhandledBugReports(),
    prisma.invitation.count({ where: pendingInvitationWhere(now) }),
  ]);
  return { unhandledBugReports, pendingInvitations };
}
