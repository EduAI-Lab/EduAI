import { spawn } from "node:child_process";
import path from "node:path";
import prisma from "~/lib/prisma.server";

export type CronJobStatusValue = "RUNNING" | "SUCCESS" | "ERROR";

export interface KnownCronJob {
  name: string;
  description: string;
  schedule: string;
  scheduleLabel: string;
  script: string;
}

export const KNOWN_CRON_JOBS: KnownCronJob[] = [
  {
    name: "backup-nightly",
    description: "Full pg_dump of all three EduAI databases",
    schedule: "0 2 * * *",
    scheduleLabel: "Daily at 02:00 UTC",
    script: "backup-nightly.sh",
  },
  {
    name: "backup-offsite",
    description: "Sync nightly dumps to off-site storage",
    schedule: "45 2 * * *",
    scheduleLabel: "Daily at 02:45 UTC",
    script: "backup-offsite.sh",
  },
  {
    name: "backup-rotate",
    description: "Prune local dumps past the retention window",
    schedule: "15 3 * * *",
    scheduleLabel: "Daily at 03:15 UTC",
    script: "backup-rotate.sh",
  },
];

export interface CronJobRunRow {
  id: string;
  jobName: string;
  status: CronJobStatusValue;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  exitCode: number | null;
}

export interface CronJobEntry extends KnownCronJob {
  lastRun: CronJobRunRow | null;
}

export async function listCronJobStatuses(): Promise<CronJobEntry[]> {
  const latestRuns = await prisma.$queryRaw<
    Array<{
      id: string;
      jobName: string;
      status: CronJobStatusValue;
      startedAt: Date;
      finishedAt: Date | null;
      message: string | null;
      exitCode: number | null;
    }>
  >`
    SELECT DISTINCT ON ("jobName")
      id, "jobName", status, "startedAt", "finishedAt", message, "exitCode"
    FROM cron_job_runs
    ORDER BY "jobName", "startedAt" DESC
  `;

  const runByName = new Map(
    latestRuns.map((r) => [
      r.jobName,
      {
        id: r.id,
        jobName: r.jobName,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        message: r.message,
        exitCode: r.exitCode,
      } satisfies CronJobRunRow,
    ]),
  );

  return KNOWN_CRON_JOBS.map((job) => ({
    ...job,
    lastRun: runByName.get(job.name) ?? null,
  }));
}

export async function getRecentCronJobRuns(jobName: string, limit = 10): Promise<CronJobRunRow[]> {
  const runs = await prisma.$queryRaw<
    Array<{
      id: string;
      jobName: string;
      status: CronJobStatusValue;
      startedAt: Date;
      finishedAt: Date | null;
      message: string | null;
      exitCode: number | null;
    }>
  >`
    SELECT id, "jobName", status, "startedAt", "finishedAt", message, "exitCode"
    FROM cron_job_runs
    WHERE "jobName" = ${jobName}
    ORDER BY "startedAt" DESC
    LIMIT ${limit}
  `;
  return runs.map((r) => ({
    id: r.id,
    jobName: r.jobName,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    message: r.message,
    exitCode: r.exitCode,
  }));
}

export async function startCronRun(jobName: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO cron_job_runs (id, "jobName", status, "startedAt", "createdAt")
    VALUES (
      gen_random_uuid()::text,
      ${jobName},
      'RUNNING'::"CronJobStatus",
      NOW(),
      NOW()
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function finishCronRun(
  id: string,
  status: "SUCCESS" | "ERROR",
  message: string,
  exitCode: number,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE cron_job_runs
    SET status     = ${status}::"CronJobStatus",
        "finishedAt" = NOW(),
        message    = ${message},
        "exitCode" = ${exitCode}
    WHERE id = ${id}
  `;
}

function resolveScriptDir(): string {
  if (process.env.CRON_SCRIPT_DIR) {
    return process.env.CRON_SCRIPT_DIR;
  }
  // Default: walk up from apps/core to the repo root, then into infra/cron.
  // Works whether cwd is the repo root or apps/core.
  const fromCwd = path.resolve(process.cwd(), "infra/cron");
  const fromAppsCore = path.resolve(process.cwd(), "../../infra/cron");
  // Pick whichever resolves to something that looks right; the caller will handle missing scripts.
  return path.resolve(process.cwd()).endsWith("apps/core") ? fromAppsCore : fromCwd;
}

export function triggerCronJobAsync(jobName: string, script: string, runId: string): void {
  const scriptPath = path.join(resolveScriptDir(), script);

  const child = spawn("bash", [scriptPath], {
    env: { ...process.env },
    timeout: 10 * 60 * 1000,
  });

  let output = "";
  child.stdout?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    output += d.toString();
  });

  child.on("close", (code: number | null) => {
    const exitCode = code ?? 1;
    const status = exitCode === 0 ? "SUCCESS" : "ERROR";
    const msg = output.slice(-1000).trim() || (exitCode === 0 ? "Completed successfully" : `Exited with code ${exitCode}`);
    finishCronRun(runId, status, msg, exitCode).catch(console.error);
  });

  child.on("error", (err: Error) => {
    const msg = `Failed to start script: ${err.message}`;
    finishCronRun(runId, "ERROR", msg, 1).catch(console.error);
  });
}
