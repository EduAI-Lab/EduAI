/**
 * Verifies the actual delete rule run by infra/cron/cleanup-invitations.sh.
 *
 * The script itself is bash + psql and isn't exercised directly by vitest, so
 * this test reads the DELETE statement out of the script file and runs it
 * against the real test database — the same query production runs, not a
 * reimplementation of it — to prove stale invitations are removed while
 * everything else is left alone.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import prisma from "~/lib/prisma.server";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../infra/cron/cleanup-invitations.sh",
);
const scriptSource = readFileSync(scriptPath, "utf-8");
const sqlMatch = scriptSource.match(/<<'SQL'\n([\s\S]*?)\nSQL/);
if (!sqlMatch) {
  throw new Error("cleanup-invitations.integration.test.ts: could not find the DELETE statement in cleanup-invitations.sh");
}
const DELETE_STALE_INVITATIONS_SQL = sqlMatch[1];

const emails: string[] = [];
function uniqueEmail(label: string): string {
  const email = `cleanup-invitations-${label}-${randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  return email;
}

async function seedInvitation(opts: {
  email: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt: Date;
  updatedAt: Date;
}) {
  const invitation = await prisma.invitation.create({
    data: {
      email: opts.email,
      role: "STUDENT",
      tokenHash: randomUUID(),
      status: opts.status,
      expiresAt: opts.expiresAt,
    },
  });
  // Invitation.updatedAt is a Prisma @updatedAt column, so any prisma.update()
  // call stamps it with the current time — a raw UPDATE is the only way to
  // backdate it to simulate an invite that has sat stale for 31 days.
  await prisma.$executeRaw`UPDATE invitations SET "updatedAt" = ${opts.updatedAt} WHERE id = ${invitation.id}`;
  return invitation.id;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

afterAll(async () => {
  await prisma.invitation.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe("cleanup-invitations.sh delete rule", () => {
  it("deletes only invitations revoked or expired more than 30 days ago", async () => {
    const staleRevoked = uniqueEmail("stale-revoked");
    const recentRevoked = uniqueEmail("recent-revoked");
    const staleExpiredPending = uniqueEmail("stale-expired-pending");
    const recentExpiredPending = uniqueEmail("recent-expired-pending");
    const notYetExpiredPending = uniqueEmail("not-yet-expired-pending");
    const staleAccepted = uniqueEmail("stale-accepted");

    await Promise.all([
      seedInvitation({
        email: staleRevoked,
        status: "REVOKED",
        expiresAt: new Date(now - 40 * DAY_MS),
        updatedAt: new Date(now - 31 * DAY_MS),
      }),
      seedInvitation({
        email: recentRevoked,
        status: "REVOKED",
        expiresAt: new Date(now - 5 * DAY_MS),
        updatedAt: new Date(now - 10 * DAY_MS),
      }),
      seedInvitation({
        email: staleExpiredPending,
        status: "PENDING",
        expiresAt: new Date(now - 31 * DAY_MS),
        updatedAt: new Date(now - 31 * DAY_MS),
      }),
      seedInvitation({
        email: recentExpiredPending,
        status: "PENDING",
        expiresAt: new Date(now - 5 * DAY_MS),
        updatedAt: new Date(now - 5 * DAY_MS),
      }),
      seedInvitation({
        email: notYetExpiredPending,
        status: "PENDING",
        expiresAt: new Date(now + 5 * DAY_MS),
        updatedAt: new Date(now - 40 * DAY_MS),
      }),
      // ACCEPTED invitations are never subject to this rule, however old.
      seedInvitation({
        email: staleAccepted,
        status: "ACCEPTED",
        expiresAt: new Date(now - 40 * DAY_MS),
        updatedAt: new Date(now - 40 * DAY_MS),
      }),
    ]);

    await prisma.$queryRawUnsafe(DELETE_STALE_INVITATIONS_SQL);

    const remaining = await prisma.invitation.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    const remainingEmails = remaining.map((r) => r.email);

    expect(remainingEmails).not.toContain(staleRevoked);
    expect(remainingEmails).not.toContain(staleExpiredPending);

    expect(remainingEmails).toContain(recentRevoked);
    expect(remainingEmails).toContain(recentExpiredPending);
    expect(remainingEmails).toContain(notYetExpiredPending);
    expect(remainingEmails).toContain(staleAccepted);
  });
});
