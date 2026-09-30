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
  updateCronSchedule,
  CronJobSettingError,
  resetCronJobSetting,
  updateCronJobSetting,
} from "~/lib/db.cron-jobs.server";
import { withErrorResponse } from "~/lib/errors.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

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
  return withErrorResponse(
    async () => {
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
    },
    { request },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      const user = await requireAdmin(request);
      if (!user) {
        return data({ error: "Unauthorized" }, { status: 401 });
      }

      const body = (await request.json()) as {
        intent?: string;
        jobName?: string;
        schedule?: string;
        scheduleLabel?: string;
        key?: string;
        value?: number | string | null;
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
        //
        // Recording is all the web process does. The cron worker's
        // dispatchManualCronRuns picks the row up on its next 30s reconcile and
        // dispatches it with the job's real `execution` mode — which a web
        // process cannot do correctly for CORE jobs, and must not do at all.
        const result = await startCronRun(jobName, "ADMIN_UI");

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

      if ((intent === "update-setting" || intent === "reset-setting") && jobName) {
        const { key } = body;
        if (!key) {
          return data({ error: "key is required" }, { status: 400 });
        }
        let change: { previous: number; value: number };
        try {
          change =
            intent === "update-setting"
              ? await updateCronJobSetting(jobName, key, Number(body.value ?? Number.NaN), user.id)
              : await resetCronJobSetting(jobName, key);
        } catch (error) {
          if (error instanceof CronJobSettingError) {
            return data({ error: error.message }, { status: 400 });
          }
          throw error;
        }
        // Unlike a schedule edit, a setting can decide when data is permanently
        // deleted (purge-deleted-materials.retainDays), so record who changed it.
        fireAndForget(
          logAuditAction({
            ...getActorContext(user),
            ...getRequestContext(request),
            actionCode: intent === "update-setting" ? "CRON_SETTING_UPDATED" : "CRON_SETTING_RESET",
            category: "SECURITY",
            entityType: "CronJobSetting",
            entityId: `${jobName}.${key}`,
            entityLabel: `${jobName}.${key}`,
            details: { jobName, key, oldValue: change.previous, newValue: change.value },
          }),
        );
        const jobs = await listCronJobStatuses();
        return data({ jobs });
      }

      return data({ error: "Unknown intent" }, { status: 400 });
    },
    { request },
  );
}
