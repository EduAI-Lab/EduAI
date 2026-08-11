// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import prisma from "~/lib/prisma.server";
import {
  finishCronRun,
  renewCronRunLease,
  startCronRun,
} from "~/lib/db.cron-jobs.server";

const testJobNames = new Set<string>();

beforeAll(async () => {
  // Prisma db push cannot represent the production partial index.
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "cron_job_runs_one_running_per_jobName"
    ON "cron_job_runs" ("jobName")
    WHERE status = 'RUNNING'
  `);
});

function testJobName(): string {
  const name = `test-cron-${randomUUID()}`;
  testJobNames.add(name);
  return name;
}

afterEach(async () => {
  if (testJobNames.size === 0) return;
  await prisma.cronJobRun.deleteMany({
    where: { jobName: { in: [...testJobNames] } },
  });
  testJobNames.clear();
});

describe("durable cron run leases", () => {
  it("converges concurrent starts on one leased owner", async () => {
    const jobName = testJobName();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => startCronRun(jobName)),
    );

    const winners = results.filter((result) => result.created);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ leaseOwner: expect.any(String) });
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);

    const rows = await prisma.$queryRaw<
      Array<{ id: string; leaseOwner: string | null; leaseExpiresAt: Date | null }>
    >`
      SELECT id, "leaseOwner", "leaseExpiresAt"
      FROM cron_job_runs
      WHERE "jobName" = ${jobName}
        AND status = 'RUNNING'::"CronJobStatus"
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].leaseOwner).toBe(winners[0].created ? winners[0].leaseOwner : null);
    expect(rows[0].leaseExpiresAt).toBeInstanceOf(Date);
  });

  it("terminalizes one expired attempt, creates exactly one successor, and fences the old owner", async () => {
    const jobName = testJobName();
    const staleId = randomUUID();
    const staleOwner = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO cron_job_runs (
        id, "jobName", status, "startedAt", "createdAt",
        "leaseOwner", "leaseHeartbeatAt", "leaseExpiresAt"
      ) VALUES (
        ${staleId}, ${jobName}, 'RUNNING'::"CronJobStatus",
        NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes',
        ${staleOwner}, NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '4 minutes'
      )
    `;

    const results = await Promise.all(
      Array.from({ length: 8 }, () => startCronRun(jobName)),
    );
    const winners = results.filter((result) => result.created);

    expect(winners).toHaveLength(1);
    expect(winners[0].runId).not.toBe(staleId);
    expect(new Set(results.map((result) => result.runId))).toEqual(
      new Set([winners[0].runId]),
    );
    await expect(renewCronRunLease(staleId, staleOwner)).resolves.toBe(false);
    await expect(
      finishCronRun(staleId, staleOwner, "SUCCESS", "late stale success", 0),
    ).resolves.toBe(false);

    const history = await prisma.$queryRaw<
      Array<{
        id: string;
        status: "RUNNING" | "SUCCESS" | "ERROR";
        leaseOwner: string | null;
        message: string | null;
      }>
    >`
      SELECT id, status, "leaseOwner", message
      FROM cron_job_runs
      WHERE "jobName" = ${jobName}
      ORDER BY "startedAt" ASC
    `;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      id: staleId,
      status: "ERROR",
      leaseOwner: null,
      message: expect.stringContaining("lease expired"),
    });
    expect(history[1]).toMatchObject({
      id: winners[0].runId,
      status: "RUNNING",
      leaseOwner: winners[0].created ? winners[0].leaseOwner : null,
    });
  });
});
