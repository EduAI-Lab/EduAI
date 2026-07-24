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
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');

const isWindows = process.platform === 'win32';

function findPrismaBin() {
  const binName = isWindows ? 'prisma.cmd' : 'prisma';
  let dir = backendRoot;
  const { root } = parse(dir);
  while (dir !== root) {
    const bin = resolve(dir, 'node_modules', '.bin', binName);
    if (existsSync(bin)) return bin;
    dir = resolve(dir, '..');
  }
  throw new Error('Could not find prisma binary. Make sure it is installed.');
}

export async function setup() {
  // globalSetup runs in the main process before setupFiles (tests/setup.js) load the root .env,
  // so load it here too — otherwise TEST_DATABASE_URL may be undefined and the up-front migrate skipped.
  dotenv.config({ path: resolve(backendRoot, '../../../.env') });

  if (!process.env.TEST_DATABASE_URL) {
    return;
  }

  const prismaBin = findPrismaBin();
  const execArgs = isWindows
    ? ['cmd.exe', ['/c', prismaBin, 'migrate', 'deploy']]
    : [prismaBin, ['migrate', 'deploy']];

  execFileSync(...execArgs, {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
