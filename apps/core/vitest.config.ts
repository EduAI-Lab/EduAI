import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { baseVitestConfig } from './vitest.shared';

const coreDir = path.dirname(fileURLToPath(import.meta.url));
const base = baseVitestConfig(coreDir);

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['app/tests/unit/**/*.test.{ts,tsx}'],
    // Core has hundreds of test files whose imports dominate wall time. Keep a
    // conservative CI cap so files can overlap without exhausting the runner.
    fileParallelism: true,
    maxWorkers: process.env.CI ? 4 : undefined,
    env: {
      PRISMA_SKIP_EAGER_CONNECT: '1',
    },
  },
});
