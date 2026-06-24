import { data } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import cron from "node-cron";

import { auth } from "~/lib/auth/server";
import {
  KNOWN_CRON_JOBS,
  getRecentCronJobRuns,
  listCronJobStatuses,
  resetCronSchedule,
  startCronRun,
  triggerCronJobAsync,
  updateCronSchedule,
} from "~/lib/db.cron-jobs.server";
import { rescheduleJob } from "~/lib/cron-scheduler.server";

async function requireAdmin(request: Request) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return null;
  }
  if (session.user.role !== "ADMIN") {
    return null;
  }
  return session.user;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireAdmin(request);
  if (!user) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobName = url.searchParams.get("job");

  if (jobName) {
    const runs = await getRecentCronJobRuns(jobName);
    return data({ runs });
  }

  const jobs = await listCronJobStatuses();
  return data({ jobs });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireAdmin(request);
  if (!user) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    intent?: string;
    jobName?: string;
    schedule?: string;
    scheduleLabel?: string;
  };
  const { intent, jobName } = body;

  if (intent === "trigger" && jobName) {
    const job = KNOWN_CRON_JOBS.find((j) => j.name === jobName);
    if (!job) {
      return data({ error: `Unknown job: ${jobName}` }, { status: 400 });
    }
    if (job.triggerEnabled === false) {
      return data({ error: `Job "${jobName}" is managed by an extension server and cannot be triggered from Core` }, { status: 400 });
    }

    const runId = await startCronRun(jobName);
    triggerCronJobAsync(jobName, job.script, runId);

    return data({ runId });
  }

  if (intent === "update-schedule" && jobName) {
    const { schedule, scheduleLabel } = body;
    if (!schedule || !scheduleLabel) {
      return data({ error: "schedule and scheduleLabel are required" }, { status: 400 });
    }
    const known = KNOWN_CRON_JOBS.find((j) => j.name === jobName);
    if (!known) {
      return data({ error: `Unknown job: ${jobName}` }, { status: 400 });
    }
    if (!cron.validate(schedule.trim())) {
      return data({ error: "Invalid cron expression" }, { status: 400 });
    }
    await updateCronSchedule(jobName, schedule.trim(), scheduleLabel.trim());
    rescheduleJob(jobName, schedule.trim());
    const jobs = await listCronJobStatuses();
    return data({ jobs });
  }

  if (intent === "reset-schedule" && jobName) {
    const known = KNOWN_CRON_JOBS.find((j) => j.name === jobName);
    if (!known) {
      return data({ error: `Unknown job: ${jobName}` }, { status: 400 });
    }
    await resetCronSchedule(jobName);
    rescheduleJob(jobName, null);
    const jobs = await listCronJobStatuses();
    return data({ jobs });
  }

  return data({ error: "Unknown intent" }, { status: 400 });
}
