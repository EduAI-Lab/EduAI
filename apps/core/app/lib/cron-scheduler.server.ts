import type { ScheduledTask } from "node-cron";
import cron from "node-cron";
import { KNOWN_CRON_JOBS, startCronRun, triggerCronJobAsync } from "~/lib/db.cron-jobs.server";
import prisma from "~/lib/prisma.server";
import { redactErrorForConsole } from "~/lib/redact.server";

declare global {
  var __cronTasks: Map<string, ScheduledTask> | undefined;
  var __cronTaskSchedules: Map<string, string> | undefined;
}

function getTaskMap(): Map<string, ScheduledTask> {
  if (!globalThis.__cronTasks) globalThis.__cronTasks = new Map();
  return globalThis.__cronTasks;
}

function getTaskScheduleMap(): Map<string, string> {
  if (!globalThis.__cronTaskSchedules) globalThis.__cronTaskSchedules = new Map();
  return globalThis.__cronTaskSchedules;
}

function scheduleOne(jobName: string, schedule: string, script: string): void {
  const tasks = getTaskMap();
  tasks.get(jobName)?.stop();
  const task = cron.schedule(
    schedule,
    () => {
      startCronRun(jobName, { source: "SCHEDULE" })
        .then(({ runId, created }) => {
          if (created) triggerCronJobAsync(jobName, script, runId);
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
  const overrides = await prisma.cronJobScheduleOverride.findMany();
  const overrideMap = new Map(overrides.map((o) => [o.jobName, o.schedule]));
  const schedules = getTaskScheduleMap();

  for (const job of KNOWN_CRON_JOBS) {
    if (!job.script) continue;
    const schedule = overrideMap.get(job.name) ?? job.schedule;
    if (schedules.get(job.name) === schedule) continue;
    try {
      scheduleOne(job.name, schedule, job.script);
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
