import { ensureCronSchedulerRunning } from "~/lib/cron-scheduler.server";
import { redactErrorForConsole } from "~/lib/redact.server";

const CRON_STARTUP_RETRY_MS = 5_000;

declare global {
  var __coreServerRuntimeStarted: boolean | undefined;
  var __coreServerRuntimeRetryTimer: ReturnType<typeof setTimeout> | undefined;
}

async function initializeCronWithRetry(): Promise<void> {
  try {
    await ensureCronSchedulerRunning();
  } catch (err) {
    console.error("[cron] Scheduler init failed:", redactErrorForConsole(err));
    globalThis.__coreServerRuntimeRetryTimer = setTimeout(() => {
      void initializeCronWithRetry();
    }, CRON_STARTUP_RETRY_MS);
    globalThis.__coreServerRuntimeRetryTimer.unref?.();
  }
}

/**
 * Start process-owned Core services. Importing this module is side-effect free;
 * the production server entry calls the function explicitly during module
 * startup, before the first HTTP request is accepted.
 */
export function startCoreServerRuntime(): void {
  if (globalThis.__coreServerRuntimeStarted) return;
  globalThis.__coreServerRuntimeStarted = true;
  void initializeCronWithRetry();
}
