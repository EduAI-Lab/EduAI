import { data } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import cron from "node-cron";

import { getRequestSession } from "~/lib/auth/request-session.server";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import {
  KNOWN_CRON_JOBS,
  getRecentCronJobRuns,
  listCronJobStatuses,
  resetCronSchedule,
  startCronRun,
  triggerCronJobAsync,
  updateCronSchedule,
} from "~/lib/db.cron-jobs.server";

// Re-checks `isActive` against the DB, not just the session's cached role
// (#1571, mirrored from `requireAdmin` in `~/lib/auth/guards.server`): a
// deactivated admin's still-live session must lose cron-job trigger/schedule
// access on their very next request, not only once that session expires.
async function requireAdmin(request: Request) {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return null;
  }
  if (session.user.role !== "ADMIN" || !(await isActiveAdminUser(session.user.id))) {
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
      return data(
        {
          error: `Job "${jobName}" is managed by an extension server and cannot be triggered from Core`,
        },
        { status: 400 },
      );
    }

    // Acquisition is one atomic database operation: it reaps an expired lease,
    // fences competing owners, and returns the live run to losing callers.
    const result = await startCronRun(jobName);
    if (result.created) {
      triggerCronJobAsync(jobName, job.script, result.runId, result.leaseOwner);
    }

    return data({ runId: result.runId, reused: !result.created });
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
    const jobs = await listCronJobStatuses();
    return data({ jobs });
  }

  if (intent === "reset-schedule" && jobName) {
    const known = KNOWN_CRON_JOBS.find((j) => j.name === jobName);
    if (!known) {
      return data({ error: `Unknown job: ${jobName}` }, { status: 400 });
    }
    await resetCronSchedule(jobName);
    const jobs = await listCronJobStatuses();
    return data({ jobs });
  }

  return data({ error: "Unknown intent" }, { status: 400 });
}
