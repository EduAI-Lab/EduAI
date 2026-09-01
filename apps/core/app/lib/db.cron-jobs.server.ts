import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import {
  redactErrorForConsole,
  redactErrorForMessage,
  redactSecretValuesInString,
} from "~/lib/redact.server";

const DEFAULT_CRON_RUN_LEASE_MS = 60_000;
const MIN_CRON_RUN_LEASE_MS = 15_000;
const MAX_CRON_RUN_LEASE_MS = 10 * 60_000;
export const DEFAULT_CRON_OUTPUT_MAX_BYTES = 64 * 1024;
const MIN_CRON_OUTPUT_MAX_BYTES = 1024;
const MAX_CRON_OUTPUT_MAX_BYTES = 1024 * 1024;
const CRON_PERSISTED_MESSAGE_MAX_BYTES = 1000;
const CRON_CHILD_KILL_GRACE_MS = 5_000;

type CronRunDb = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

declare global {
  var __manualCronRunIds: Set<string> | undefined;
}

export type StartCronRunResult =
  | { runId: string; created: true; leaseOwner: string }
  | { runId: string; created: false };

export function resolveCronRunLeaseMs(): number {
  const configured = Number(process.env.CRON_RUN_LEASE_MS);
  if (!Number.isSafeInteger(configured) || configured < MIN_CRON_RUN_LEASE_MS) {
    return DEFAULT_CRON_RUN_LEASE_MS;
  }
  return Math.min(configured, MAX_CRON_RUN_LEASE_MS);
}

export function resolveCronOutputMaxBytes(): number {
  const configured = Number(process.env.CRON_OUTPUT_MAX_BYTES);
  if (!Number.isSafeInteger(configured) || configured < MIN_CRON_OUTPUT_MAX_BYTES) {
    return DEFAULT_CRON_OUTPUT_MAX_BYTES;
  }
  return Math.min(configured, MAX_CRON_OUTPUT_MAX_BYTES);
}

export type CronJobStatusValue = "RUNNING" | "SUCCESS" | "ERROR";
export type CronJobTriggerSource = "SCHEDULE" | "ADMIN_UI" | "ADMIN_CHAT" | "UNKNOWN";
export type CronJobExecution = "SCRIPT" | "CORE";

export interface KnownCronJob {
  name: string;
  description: string;
  schedule: string;
  scheduleLabel: string;
  script: string;
  execution?: CronJobExecution;
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
    script: "Core handler",
    execution: "CORE",
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
    description:
      "Nullify stale core_course_id / core_topic_id / core_question_id references on Core 404",
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

async function findRunningCronRunWithDb(
  db: CronRunDb,
  jobName: string,
): Promise<{ id: string } | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM cron_job_runs
    WHERE "jobName" = ${jobName}
      AND status = 'RUNNING'::"CronJobStatus"
      AND "leaseExpiresAt" > statement_timestamp()
    ORDER BY "startedAt" DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findRunningCronRun(jobName: string): Promise<{ id: string } | null> {
  return findRunningCronRunWithDb(prisma, jobName);
}

async function reapExpiredCronRunsWithDb(db: CronRunDb, jobName?: string): Promise<number> {
  const jobFilter = jobName ? Prisma.sql`AND "jobName" = ${jobName}` : Prisma.empty;
  return db.$executeRaw`
    UPDATE cron_job_runs
    SET status = 'ERROR'::"CronJobStatus",
        "finishedAt" = statement_timestamp(),
        message = CASE
          WHEN message IS NULL OR BTRIM(message) = ''
            THEN 'Cron run lease expired; a later process may safely retry it'
          ELSE message || E'\nCron run lease expired; a later process may safely retry it'
        END,
        "exitCode" = COALESCE("exitCode", 1),
        "leaseHeartbeatAt" = NULL,
        "leaseExpiresAt" = NULL
    WHERE status = 'RUNNING'::"CronJobStatus"
      AND "leaseExpiresAt" <= statement_timestamp()
      ${jobFilter}
  `;
}

/** Terminalize expired attempts while preserving each crashed row as audit history. */
export async function reapExpiredCronRuns(): Promise<number> {
  return reapExpiredCronRunsWithDb(prisma);
}

export async function startCronRun(jobName: string): Promise<StartCronRunResult> {
  const leaseOwner = randomUUID();
  const leaseMs = resolveCronRunLeaseMs();

  return prisma.$transaction(async (tx) => {
    // Serialize acquisition for one logical job across scheduler replicas and
    // manual triggers. The partial unique index remains the database backstop.
    await tx.$queryRaw<Array<{ locked: boolean }>>`
      WITH job_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtextextended(${jobName}, 0))
      )
      SELECT TRUE AS locked FROM job_lock
    `;

    await reapExpiredCronRunsWithDb(tx, jobName);
    const running = await findRunningCronRunWithDb(tx, jobName);
    if (running) return { runId: running.id, created: false };

    // statement_timestamp() is evaluated after any advisory-lock wait and uses
    // the database clock, so host clock skew cannot shorten or extend a lease.
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO cron_job_runs (
        id, "jobName", status, "startedAt", "createdAt",
        "leaseOwner", "leaseHeartbeatAt", "leaseExpiresAt"
      )
      VALUES (
        gen_random_uuid()::text,
        ${jobName},
        'RUNNING'::"CronJobStatus",
        statement_timestamp(),
        statement_timestamp(),
        ${leaseOwner},
        statement_timestamp(),
        statement_timestamp() + (${leaseMs} * INTERVAL '1 millisecond')
      )
      RETURNING id
    `;
    if (!inserted[0]?.id) {
      throw new Error(`Failed to acquire cron run lease for job "${jobName}"`);
    }
    return { runId: inserted[0].id, created: true, leaseOwner };
  });
}

export async function renewCronRunLease(id: string, leaseOwner: string): Promise<boolean> {
  const leaseMs = resolveCronRunLeaseMs();
  const updated = await prisma.$executeRaw`
    UPDATE cron_job_runs
    SET "leaseHeartbeatAt" = statement_timestamp(),
        "leaseExpiresAt" = statement_timestamp() + (${leaseMs} * INTERVAL '1 millisecond')
    WHERE id = ${id}
      AND status = 'RUNNING'::"CronJobStatus"
      AND "leaseOwner" = ${leaseOwner}
      AND "leaseExpiresAt" > statement_timestamp()
  `;
  return updated === 1;
}

export async function finishCronRun(
  id: string,
  leaseOwner: string,
  status: "SUCCESS" | "ERROR",
  message: string,
  exitCode: number,
): Promise<boolean> {
  // `message` is the tail of a cron script's stdout/stderr, and those scripts are spawned with
  // the full `process.env` — a crash trace can print DATABASE_URL or an API key verbatim. This
  // is the single chokepoint every run outcome is persisted through, so scrub it here.
  const safeMessage = redactSecretValuesInString(message);
  const updated = await prisma.$executeRaw`
    UPDATE cron_job_runs
    SET status     = ${status}::"CronJobStatus",
        "finishedAt" = statement_timestamp(),
        message    = ${safeMessage},
        "exitCode" = ${exitCode},
        "leaseHeartbeatAt" = NULL,
        "leaseExpiresAt" = NULL
    WHERE id = ${id}
      AND status = 'RUNNING'::"CronJobStatus"
      AND "leaseOwner" = ${leaseOwner}
      AND "leaseExpiresAt" > statement_timestamp()
  `;
  return updated === 1;
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

function utf8Tail(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;

  // Starting in the middle of a multi-byte character produces a replacement
  // character. Drop only that damaged prefix while retaining the diagnostic tail.
  return bytes
    .subarray(bytes.length - maxBytes)
    .toString("utf8")
    .replace(/^\uFFFD+/, "");
}

function persistedCronMessage(
  captured: Buffer,
  capturedBytes: number,
  exitCode: number,
  outputLimit: number | null,
  overrideMessage?: string,
): string {
  if (overrideMessage) {
    return utf8Tail(
      redactSecretValuesInString(overrideMessage),
      CRON_PERSISTED_MESSAGE_MAX_BYTES,
    ).trim();
  }

  // The capture is bounded before conversion to a string. Redact the complete
  // bounded capture before selecting its tail so a long KEY=secret assignment
  // cannot lose its identifying key before the value is scrubbed.
  const safeOutput = redactSecretValuesInString(
    captured.subarray(0, capturedBytes).toString("utf8"),
  );
  if (outputLimit !== null) {
    const marker = `Cron output limit of ${outputLimit} bytes exceeded; process terminated`;
    const diagnosticBudget = Math.max(
      0,
      CRON_PERSISTED_MESSAGE_MAX_BYTES - Buffer.byteLength(marker) - 1,
    );
    const diagnostic = utf8Tail(safeOutput, diagnosticBudget).trim();
    return diagnostic ? `${diagnostic}\n${marker}` : marker;
  }

  return (
    utf8Tail(safeOutput, CRON_PERSISTED_MESSAGE_MAX_BYTES).trim() ||
    (exitCode === 0 ? "Completed successfully" : `Exited with code ${exitCode}`)
  );
}

export function triggerCronJobAsync(
  jobName: string,
  script: string,
  runId: string,
  leaseOwner: string,
  execution: CronJobExecution = "SCRIPT",
): void {
  if (execution === "CORE") {
    void import("~/lib/cron-notify-api-key-expiry.server")
      .then(({ notifyExpiringApiKeys }) => notifyExpiringApiKeys())
      .then(({ notified }) =>
        finishCronRun(
          runId,
          leaseOwner,
          "SUCCESS",
          `Sent ${notified} API key expiry notification(s)`,
          0,
        ),
      )
      .catch((cause: unknown) =>
        finishCronRun(
          runId,
          leaseOwner,
          "ERROR",
          utf8Tail(
            `Core handler failed: ${redactErrorForMessage(cause)}`,
            CRON_PERSISTED_MESSAGE_MAX_BYTES,
          ),
          1,
        ).catch((cause: unknown) =>
          console.error("[cron] finishCronRun failed:", redactErrorForConsole(cause)),
        ),
      );
    return;
  }

  const scriptDir = resolveScriptDir();
  let child: ReturnType<typeof spawn>;

  try {
    // Pass the script dir as cwd so Node sets the working directory at the OS level.
    child = spawn("bash", [`./${script}`], {
      env: { ...process.env, CORE_CRON_RUN_ID: runId },
      cwd: scriptDir,
      timeout: 10 * 60 * 1000,
    });
  } catch (err) {
    const message = utf8Tail(
      `Failed to start script: ${redactErrorForMessage(err)}`,
      CRON_PERSISTED_MESSAGE_MAX_BYTES,
    );
    void finishCronRun(runId, leaseOwner, "ERROR", message, 1).catch((cause: unknown) =>
      console.error("[cron] finishCronRun failed:", redactErrorForConsole(cause)),
    );
    return;
  }

  const outputLimit = resolveCronOutputMaxBytes();
  const captured = Buffer.allocUnsafe(outputLimit);
  let capturedBytes = 0;
  let exceededOutputLimit = false;
  let finalized = false;
  let terminating = false;
  let leaseRenewalInFlight = false;
  let forcedMessage: string | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const terminate = (message: string): void => {
    if (terminating || finalized) return;
    terminating = true;
    forcedMessage ??= message;
    try {
      child.kill("SIGTERM");
    } catch (err) {
      console.error(`[cron] ${jobName} SIGTERM failed:`, redactErrorForConsole(err));
    }
    killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (err) {
        console.error(`[cron] ${jobName} SIGKILL failed:`, redactErrorForConsole(err));
      }
    }, CRON_CHILD_KILL_GRACE_MS);
    killTimer.unref?.();
  };

  const capture = (chunk: Buffer | string): void => {
    if (exceededOutputLimit) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = outputLimit - capturedBytes;
    const copied = Math.min(remaining, bytes.length);
    if (copied > 0) {
      bytes.copy(captured, capturedBytes, 0, copied);
      capturedBytes += copied;
    }
    if (bytes.length > remaining) {
      exceededOutputLimit = true;
      // Keep the capture bounded and fail closed: otherwise a script that
      // continuously writes can keep consuming pipe/runtime memory indefinitely.
      terminate(`Cron output limit of ${outputLimit} bytes exceeded`);
    }
  };

  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  const leaseHeartbeatMs = Math.max(5_000, Math.floor(resolveCronRunLeaseMs() / 3));
  const heartbeatTimer = setInterval(() => {
    if (finalized || leaseRenewalInFlight) return;
    leaseRenewalInFlight = true;
    void renewCronRunLease(runId, leaseOwner)
      .then((renewed) => {
        if (!renewed) {
          terminate("Cron run lease ownership was lost; process terminated");
        }
      })
      .catch((cause: unknown) => {
        console.error(`[cron] ${jobName} lease renewal failed:`, redactErrorForConsole(cause));
        // Continuing after the database can no longer confirm our lease risks
        // overlapping external side effects with a successor after expiry.
        terminate("Cron run lease could not be renewed; process terminated");
      })
      .finally(() => {
        leaseRenewalInFlight = false;
      });
  }, leaseHeartbeatMs);
  heartbeatTimer.unref?.();

  const finalize = (code: number | null, overrideMessage?: string): void => {
    if (finalized) return;
    finalized = true;
    clearInterval(heartbeatTimer);
    if (killTimer) clearTimeout(killTimer);

    const rawExitCode = code ?? 1;
    const exitCode = exceededOutputLimit || forcedMessage ? 1 : rawExitCode;
    const status = exitCode === 0 ? "SUCCESS" : "ERROR";
    const message = persistedCronMessage(
      captured,
      capturedBytes,
      exitCode,
      exceededOutputLimit ? outputLimit : null,
      overrideMessage ?? (exceededOutputLimit ? undefined : forcedMessage),
    );
    void finishCronRun(runId, leaseOwner, status, message, exitCode)
      .then((finished) => {
        if (!finished) {
          console.warn(`[cron] ${jobName} completion ignored after lease ownership changed`);
        }
      })
      .catch((cause: unknown) =>
        console.error("[cron] finishCronRun failed:", redactErrorForConsole(cause)),
      );
  };

  child.on("close", (code: number | null) => finalize(code));
  child.on("error", (err: Error) => {
    finalize(1, `Failed to start script: ${err.message}`);
  });
}

/**
 * Dispatch administrator-triggered runs from the dedicated worker. Keeping
 * this claim in the worker means shell scripts always execute as eduai-cron;
 * the Core web process only records the requested run in Postgres.
 */
export async function dispatchManualCronRuns(): Promise<void> {
  const claimed =
    globalThis.__manualCronRunIds ?? (globalThis.__manualCronRunIds = new Set<string>());
  const rows = await prisma.$queryRaw<Array<{ id: string; jobName: string; leaseOwner: string }>>`
    SELECT id, "jobName", "leaseOwner"
    FROM cron_job_runs
    WHERE status = 'RUNNING'::"CronJobStatus"
      AND "triggerSource" IN ('ADMIN_UI'::"CronJobTriggerSource", 'ADMIN_CHAT'::"CronJobTriggerSource")
    ORDER BY "startedAt" ASC
    LIMIT 20
  `;

  for (const row of rows) {
    if (claimed.has(row.id)) continue;
    const job = KNOWN_CRON_JOBS.find((candidate) => candidate.name === row.jobName);
    if (!job || job.triggerEnabled === false) continue;
    claimed.add(row.id);
    triggerCronJobAsync(row.jobName, job.script, row.id, row.leaseOwner, job.execution);
  }
}
