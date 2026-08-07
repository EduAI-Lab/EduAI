import { spawn } from "node:child_process";
import path from "node:path";
import prisma from "~/lib/prisma.server";
import { redactErrorForConsole, redactSecretValuesInString } from "~/lib/redact.server";

export type CronJobStatusValue = "RUNNING" | "SUCCESS" | "ERROR";
export type CronJobTriggerSource = "SCHEDULE" | "ADMIN_UI" | "ADMIN_CHAT" | "UNKNOWN";

export interface KnownCronJob {
  name: string;
  description: string;
  schedule: string;
  scheduleLabel: string;
  script: string;
  triggerEnabled?: boolean;
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
  {
    name: "cleanup-invitations",
    description: "Delete revoked/expired invitations past a 30-day grace period",
    schedule: "30 3 * * *",
    scheduleLabel: "Daily at 03:30 UTC",
    script: "cleanup-invitations.sh",
  },
  {
    name: "notify-api-key-expiry",
    description: "Email users whose AI provider API keys expire in 7 days",
    schedule: "0 4 * * *",
    scheduleLabel: "Daily at 04:00 UTC",
    script: "notify-api-key-expiry.sh",
  },
  {
    name: "ai-tutor-reconcile",
    description: "Nullify stale coreOfferingId / coreTopicId references on Core 404",
    schedule: "0 2 * * *",
    scheduleLabel: "Daily at 02:00 UTC (AI Tutor server)",
    script: "",
    triggerEnabled: false,
  },
  {
    name: "qm-reconcile",
    description: "Nullify stale core_course_id / core_topic_id / core_question_id references on Core 404",
    schedule: "0 2 * * *",
    scheduleLabel: "Daily at 02:00 UTC (QM server)",
    script: "",
    triggerEnabled: false,
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
  triggerSource: CronJobTriggerSource;
  triggeredByUserId: string | null;
}

export interface CronJobEntry extends KnownCronJob {
  lastRun: CronJobRunRow | null;
  scheduleOverridden?: boolean;
}

export async function listCronJobStatuses(): Promise<CronJobEntry[]> {
  const [latestRuns, overrides] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        jobName: string;
        status: CronJobStatusValue;
        startedAt: Date;
        finishedAt: Date | null;
        message: string | null;
        exitCode: number | null;
        triggerSource: CronJobTriggerSource;
        triggeredByUserId: string | null;
      }>
    >`
      SELECT DISTINCT ON ("jobName")
        id, "jobName", status, "startedAt", "finishedAt", message, "exitCode", "triggerSource", "triggeredByUserId"
      FROM cron_job_runs
      ORDER BY "jobName", "startedAt" DESC
    `,
    prisma.cronJobScheduleOverride.findMany(),
  ]);

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
        triggerSource: r.triggerSource,
        triggeredByUserId: r.triggeredByUserId,
      } satisfies CronJobRunRow,
    ]),
  );

  const overrideByName = new Map(overrides.map((o) => [o.jobName, o]));

  return KNOWN_CRON_JOBS.map((job) => {
    const override = overrideByName.get(job.name);
    return {
      ...job,
      schedule: override?.schedule ?? job.schedule,
      scheduleLabel: override?.scheduleLabel ?? job.scheduleLabel,
      scheduleOverridden: override != null,
      lastRun: runByName.get(job.name) ?? null,
    };
  });
}

export async function updateCronSchedule(
  jobName: string,
  schedule: string,
  scheduleLabel: string,
): Promise<void> {
  await prisma.cronJobScheduleOverride.upsert({
    where: { jobName },
    create: { jobName, schedule, scheduleLabel },
    update: { schedule, scheduleLabel },
  });
}

export async function resetCronSchedule(jobName: string): Promise<void> {
  await prisma.cronJobScheduleOverride.deleteMany({ where: { jobName } });
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
      triggerSource: CronJobTriggerSource;
      triggeredByUserId: string | null;
    }>
  >`
    SELECT id, "jobName", status, "startedAt", "finishedAt", message, "exitCode", "triggerSource", "triggeredByUserId"
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
    triggerSource: r.triggerSource,
    triggeredByUserId: r.triggeredByUserId,
  }));
}

export async function findRunningCronRun(
  jobName: string,
): Promise<{ id: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM cron_job_runs
    WHERE "jobName" = ${jobName}
      AND status = 'RUNNING'::"CronJobStatus"
    ORDER BY "startedAt" DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function startCronRun(
  jobName: string,
  metadata: { source: CronJobTriggerSource; triggeredByUserId?: string } = { source: "UNKNOWN" },
): Promise<{ runId: string; created: boolean }> {
  // Insert first; partial unique index (one RUNNING per jobName) makes concurrent
  // triggers conflict instead of double-spawning. ON CONFLICT DO NOTHING + reclaim.
  // `created: true` only when this caller won the INSERT — losers must not spawn.
  const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO cron_job_runs (id, "jobName", status, "startedAt", "triggerSource", "triggeredByUserId", "createdAt")
    VALUES (
      gen_random_uuid()::text,
      ${jobName},
      'RUNNING'::"CronJobStatus",
      NOW(),
      ${metadata.source}::"CronJobTriggerSource",
      ${metadata.triggeredByUserId ?? null},
      NOW()
    )
    ON CONFLICT ("jobName") WHERE (status = 'RUNNING') DO NOTHING
    RETURNING id
  `;
  if (inserted[0]?.id) {
    return { runId: inserted[0].id, created: true };
  }

  const running = await findRunningCronRun(jobName);
  if (running) {
    return { runId: running.id, created: false };
  }

  throw new Error(`Failed to start or reclaim cron run for job "${jobName}"`);
}

export async function finishCronRun(
  id: string,
  status: "SUCCESS" | "ERROR",
  message: string,
  exitCode: number,
): Promise<void> {
  // `message` is the tail of a cron script's stdout/stderr, and those scripts are spawned with
  // the full `process.env` — a crash trace can print DATABASE_URL or an API key verbatim. This
  // is the single chokepoint every run outcome is persisted through, so scrub it here.
  const safeMessage = redactSecretValuesInString(message);
  await prisma.$executeRaw`
    UPDATE cron_job_runs
    SET status     = ${status}::"CronJobStatus",
        "finishedAt" = NOW(),
        message    = ${safeMessage},
        "exitCode" = ${exitCode}
    WHERE id = ${id}
  `;
}

function resolveScriptDir(): string {
  if (process.env.CRON_SCRIPT_DIR) {
    return process.env.CRON_SCRIPT_DIR;
  }
  const cwd = path.resolve(process.cwd());
  // Normalize separators for the check so this works on Windows (path.resolve
  // produces backslashes there, making endsWith("apps/core") always false).
  const cwdNorm = cwd.replace(/\\/g, "/");
  const fromAppsCore = path.resolve(cwd, "../../infra/cron");
  const fromCwd = path.resolve(cwd, "infra/cron");
  return cwdNorm.endsWith("apps/core") ? fromAppsCore : fromCwd;
}

export function triggerCronJobAsync(jobName: string, script: string, runId: string): void {
  // Pass the script dir as cwd so Node sets the working directory at the OS level
  const scriptDir = resolveScriptDir();

  const child = spawn("bash", [`./${script}`], {
    env: { ...process.env, CORE_CRON_RUN_ID: runId },
    cwd: scriptDir,
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
    // Redact before truncating. Slicing first can cut a long assignment between its key and its
    // value, and the redactor recognises a secret only by the key that precedes it — a 1500-char
    // `API_KEY=…` would arrive as an unattributed tail and survive (PR #1291 review).
    const msg =
      redactSecretValuesInString(output).slice(-1000).trim() ||
      (exitCode === 0 ? "Completed successfully" : `Exited with code ${exitCode}`);
    finishCronRun(runId, status, msg, exitCode).catch((err: unknown) =>
      console.error("[cron] finishCronRun failed:", redactErrorForConsole(err)),
    );
  });

  child.on("error", (err: Error) => {
    const msg = `Failed to start script: ${err.message}`;
    finishCronRun(runId, "ERROR", msg, 1).catch((err: unknown) =>
      console.error("[cron] finishCronRun failed:", redactErrorForConsole(err)),
    );
  });
}
