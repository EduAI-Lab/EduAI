/**
 * Vitest globalSetup — runs ONCE in the main process before any test file.
 *
 * When TEST_DATABASE_URL is set (integration / coverage runs), it synchronizes the
 * schema a single time up front. Individual integration files only truncate + seed in
 * their beforeEach hooks; without this, the first file to run would truncate a table that
 * no file had created yet (the `sync({ alter: true })` inside connectDatabase swallows its
 * own errors), producing an order-dependent "relation does not exist" flake when the unit
 * and integration suites share one worker (coverage run).
 *
 * Without TEST_DATABASE_URL this is a no-op: integration suites self-skip (see `describeDb`),
 * so a plain unit run never touches a database.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

export async function setup() {
  // globalSetup runs in the main process before setupFiles (tests/setup.js) load the root .env,
  // so load it here too — otherwise TEST_DATABASE_URL may be undefined and the up-front sync skipped.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

  if (!process.env.TEST_DATABASE_URL) {
    return;
  }

  // database.js builds its Sequelize instance from DATABASE_URL at import time, so this must
  // be set before the dynamic import below (setupFiles run per-worker, after globalSetup).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  const { sequelize } = await import('../src/config/database.js');
  await import('../src/schema/index.js');

  // Authenticate + sync directly rather than via connectDatabase() so we do not start the
  // background reconnection interval, which would keep this main process alive after teardown.
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  await sequelize.close();
}
