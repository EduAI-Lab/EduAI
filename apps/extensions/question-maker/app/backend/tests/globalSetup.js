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
import { runPrismaMigrateDeploy } from './helpers/prismaCli.js';
import { loadTestEnv, TEST_ENV_PATH } from './helpers/testEnv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');

/** `postgresql://user:pw@host:5432/db` -> `host:5432/db`, so nothing secret reaches the log. */
function describeTarget(databaseUrl) {
  try {
    const { host, pathname } = new URL(databaseUrl);
    return `${host}${pathname}`;
  } catch {
    return 'TEST_DATABASE_URL';
  }
}

export async function setup() {
  // globalSetup runs in the main process before setupFiles (tests/setup.js) load the .env, so load
  // it here too — otherwise TEST_DATABASE_URL may be undefined and the up-front migrate skipped.
  // The path itself lives in helpers/testEnv.js: resolving it separately here is exactly what let
  // this hook silently no-op on local runs (#1368). CI was unaffected because it sets
  // TEST_DATABASE_URL as a real environment variable.
  loadTestEnv();

  if (!process.env.TEST_DATABASE_URL) {
    return;
  }

  // Anything thrown here aborts the whole vitest run before a single test file loads, including the
  // unit files that `vitest.coverage.config.js` pulls in alongside the integration ones. Prisma's
  // own failure is a wall of CLI stderr, so restate the actionable part: the DB the run was pointed
  // at, and the fact that it has to be up before tests start.
  try {
    runPrismaMigrateDeploy({ cwd: backendRoot, databaseUrl: process.env.TEST_DATABASE_URL });
  } catch (err) {
    throw new Error(
      `Could not apply migrations to the test database (${describeTarget(process.env.TEST_DATABASE_URL)}).\n` +
        `Start it with \`docker compose -f docker-compose.dev.yml up -d\`, or unset TEST_DATABASE_URL ` +
        `in ${TEST_ENV_PATH} to run the unit suites alone.\n` +
        `Original failure: ${err.message}`,
      { cause: err },
    );
  }
}
