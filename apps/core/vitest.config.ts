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
  },
});
