/**
 * Vitest globalSetup — runs ONCE in the main process before any test file.
 *
 * When TEST_DATABASE_URL is set (integration / coverage runs), it applies the
 * Prisma migration history a single time up front. Individual integration test
 * files truncate + seed in their beforeEach hooks; without this up-front
 * migrate, the first file to run would attempt to truncate a table that does
 * not exist yet.
 *
 * Without TEST_DATABASE_URL this is a no-op: integration suites self-skip (see
 * `describeDb`), so a plain unit run never touches a database.
 *
 * Unlike ai-tutor's globalSetup, this does not create the test database itself
 * — CI's `qm-db` service container and `docker-compose.test.yml` already
 * provision `question_maker_test` before tests run.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { runPrismaMigrateDeploy } from './helpers/prismaCli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');

export async function setup() {
  // globalSetup runs in the main process before setupFiles (tests/setup.js) load the root .env,
  // so load it here too — otherwise TEST_DATABASE_URL may be undefined and the up-front migrate skipped.
  dotenv.config({ path: resolve(backendRoot, '../../../.env') });

  if (!process.env.TEST_DATABASE_URL) {
    return;
  }

  runPrismaMigrateDeploy({ cwd: backendRoot, databaseUrl: process.env.TEST_DATABASE_URL });
}
