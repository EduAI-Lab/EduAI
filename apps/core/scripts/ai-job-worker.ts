import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(appRoot, ".env");
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

// These modules construct the Prisma and Redis singletons at import time, so
// they must be loaded only after the standalone process has loaded apps/core/.env.
const [{ default: redis }, { closeAiJobWorkers, startAiJobWorkers }] =
  await Promise.all([
    import("../app/lib/queue/connection.server"),
    import("../app/lib/queue/worker.server"),
  ]);

const workers = startAiJobWorkers();
console.log(
  `[ai-job-worker] listening on ${workers.map((worker) => worker.name).join(", ")}`,
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ai-job-worker] received ${signal}; closing workers`);
  await closeAiJobWorkers(workers);
  await redis.quit();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("[ai-job-worker] shutdown failed", error);
        process.exit(1);
      });
  });
}
