import redis from "../app/lib/queue/connection.server";
import {
  closeAiJobWorkers,
  startAiJobWorkers,
} from "../app/lib/queue/worker.server";

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
