import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { baseVitestConfig } from "./vitest.shared";

const coreDir = path.dirname(fileURLToPath(import.meta.url));
const base = baseVitestConfig(coreDir);

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["app/tests/unit/**/*.test.{ts,tsx}"],
    // Core has hundreds of test files whose imports dominate wall time. Leave
    // capacity for the concurrently running UI and integration test processes.
    fileParallelism: true,
    maxWorkers: process.env.CI ? 2 : undefined,
    env: {
      VITEST_SKIP_PRISMA_EAGER_CONNECT: "1",
    },
  },
});
