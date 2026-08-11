import type { ScheduledTask } from "node-cron";
import cron from "node-cron";
import {
  KNOWN_CRON_JOBS,
  reapExpiredCronRuns,
  startCronRun,
  triggerCronJobAsync,
} from "~/lib/db.cron-jobs.server";
import prisma from "~/lib/prisma.server";
import { redactErrorForConsole } from "~/lib/redact.server";

declare global {
  var __cronTasks: Map<string, ScheduledTask> | undefined;
  var __cronSchedulerInitPromise: Promise<void> | undefined;
}

function getTaskMap(): Map<string, ScheduledTask> {
  if (!globalThis.__cronTasks) globalThis.__cronTasks = new Map();
  return globalThis.__cronTasks;
}

function getTaskScheduleMap(): Map<string, string> {
  if (!globalThis.__cronTaskSchedules) globalThis.__cronTaskSchedules = new Map();
  return globalThis.__cronTaskSchedules;
}

function scheduleOne(
  jobName: string,
  schedule: string,
  script: string,
  execution: "SCRIPT" | "CORE" = "SCRIPT",
): void {
  const tasks = getTaskMap();
  tasks.get(jobName)?.stop();
  const task = cron.schedule(
    schedule,
    () => {
      startCronRun(jobName)
        .then((result) => {
          if (result.created) {
            triggerCronJobAsync(jobName, script, result.runId, result.leaseOwner);
          }
        })
        .catch((err: unknown) =>
          console.error(`[cron] ${jobName} failed to start:`, redactErrorForConsole(err)),
        );
    },
    { timezone: "UTC" },
  );
  tasks.set(jobName, task);
  getTaskScheduleMap().set(jobName, schedule);
}

/** Refresh schedules from the database in the dedicated cron worker only. */
export async function refreshCronSchedules(): Promise<void> {
  try {
    await dispatchManualCronRuns();
  } catch (err) {
    console.error("[cron] Failed to dispatch manual runs:", redactErrorForConsole(err));
  }
  const overrides = await prisma.cronJobScheduleOverride.findMany();
  const overrideMap = new Map(overrides.map((o) => [o.jobName, o.schedule]));
  const schedules = getTaskScheduleMap();

  for (const job of KNOWN_CRON_JOBS) {
    if (!job.script && job.execution !== "CORE") continue;
    const schedule = overrideMap.get(job.name) ?? job.schedule;
    if (schedules.get(job.name) === schedule) continue;
    try {
      scheduleOne(job.name, schedule, job.script, job.execution);
    } catch (err) {
      console.error(`[cron] Failed to schedule ${job.name}:`, redactErrorForConsole(err));
    }
  }
}

export function stopCronScheduler(): void {
  for (const task of getTaskMap().values()) task.stop();
  getTaskMap().clear();
  getTaskScheduleMap().clear();
}

/**
 * Backward-compatible hook for admin-tool callers. Scheduling is owned by the
 * dedicated worker; it observes the persisted override on its next refresh.
 */
export function rescheduleJob(jobName: string, schedule: string | null): void {
  const job = KNOWN_CRON_JOBS.find((j) => j.name === jobName);
  if (!job?.script) return;
  scheduleOne(jobName, schedule ?? job.schedule, job.script);
}

/**
 * Initialize the in-process cron scheduler once per process. Concurrent callers
 * share the same promise; a failed initialization clears it so the server
 * runtime can retry instead of permanently suppressing cron.
 */
export function ensureCronSchedulerRunning(): Promise<void> {
  if (globalThis.__cronSchedulerInitPromise) {
    return globalThis.__cronSchedulerInitPromise;
  }

  const initialize = (async () => {
    const reaped = await reapExpiredCronRuns();
    if (reaped > 0) {
      console.warn(`[cron] Reaped ${reaped} expired run lease${reaped === 1 ? "" : "s"}`);
    }

    const overrides = await prisma.cronJobScheduleOverride.findMany();
    const overrideMap = new Map(overrides.map((o) => [o.jobName, o.schedule]));
    for (const job of KNOWN_CRON_JOBS) {
      if (!job.script) continue; // external extension jobs — skip
      try {
        scheduleOne(job.name, overrideMap.get(job.name) ?? job.schedule, job.script);
      } catch (err) {
        console.error(`[cron] Failed to schedule ${job.name}:`, redactErrorForConsole(err));
      }
    }
    console.log("[cron] In-process scheduler started");
  })();

  globalThis.__cronSchedulerInitPromise = initialize;
  void initialize.catch(() => {
    if (globalThis.__cronSchedulerInitPromise === initialize) {
      globalThis.__cronSchedulerInitPromise = undefined;
    }
  });
  return initialize;
}
