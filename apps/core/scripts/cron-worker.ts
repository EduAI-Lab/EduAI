import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(appRoot, ".env");
if (existsSync(envPath)) loadEnvFile(envPath);

const [{ default: prisma }, { refreshCronSchedules, stopCronScheduler }] = await Promise.all([
  import("../app/lib/prisma.server"),
  import("../app/lib/cron-scheduler.server"),
]);

async function refresh(): Promise<void> {
  try {
    await refreshCronSchedules();
  } catch (error) {
    console.error("[cron-worker] schedule refresh failed", error);
  }
}

await refresh();
console.log("[cron-worker] scheduler started; reconciling schedules every 30 seconds");
const refreshTimer = setInterval(() => void refresh(), 30_000);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[cron-worker] received ${signal}; stopping scheduler`);
  clearInterval(refreshTimer);
  stopCronScheduler();
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("[cron-worker] shutdown failed", error);
        process.exit(1);
      });
  });
}
