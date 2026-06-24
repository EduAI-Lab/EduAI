import type { ScheduledTask } from "node-cron";
import cron from "node-cron";
import { KNOWN_CRON_JOBS, startCronRun, triggerCronJobAsync } from "~/lib/db.cron-jobs.server";
import prisma from "~/lib/prisma.server";

declare global {
  var __cronTasks: Map<string, ScheduledTask> | undefined;
  var __cronSchedulerReady: boolean | undefined;
}

function getTaskMap(): Map<string, ScheduledTask> {
  if (!globalThis.__cronTasks) {
    globalThis.__cronTasks = new Map();
  }
  return globalThis.__cronTasks;
}

function scheduleOne(jobName: string, schedule: string, script: string): void {
  const tasks = getTaskMap();
  tasks.get(jobName)?.stop();
  const task = cron.schedule(
    schedule,
    () => {
      startCronRun(jobName)
        .then((runId) => triggerCronJobAsync(jobName, script, runId))
        .catch((err: unknown) => console.error(`[cron] ${jobName} failed to start:`, err));
    },
    { timezone: "UTC" },
  );
  tasks.set(jobName, task);
}

/**
 * Re-schedule a single job after a UI-driven schedule change.
 * Passing null reverts to the job's default schedule.
 * No-ops for external jobs (no script).
 */
export function rescheduleJob(jobName: string, schedule: string | null): void {
  const job = KNOWN_CRON_JOBS.find((j) => j.name === jobName);
  if (!job?.script) return;
  scheduleOne(jobName, schedule ?? job.schedule, job.script);
}

/**
 * Initialize the in-process cron scheduler. Safe to call on every request —
 * it uses a globalThis flag so the actual setup only runs once per process.
 */
export function ensureCronSchedulerRunning(): void {
  if (globalThis.__cronSchedulerReady) return;
  globalThis.__cronSchedulerReady = true;

  prisma.cronJobScheduleOverride
    .findMany()
    .then((overrides) => {
      const overrideMap = new Map(overrides.map((o) => [o.jobName, o.schedule]));
      for (const job of KNOWN_CRON_JOBS) {
        if (!job.script) continue; // external extension jobs — skip
        try {
          scheduleOne(job.name, overrideMap.get(job.name) ?? job.schedule, job.script);
        } catch (err) {
          console.error(`[cron] Failed to schedule ${job.name}:`, err);
        }
      }
      console.log("[cron] In-process scheduler started");
    })
    .catch((err: unknown) => {
      console.error("[cron] Scheduler init failed:", err);
      globalThis.__cronSchedulerReady = false; // allow retry on next request
    });
}
