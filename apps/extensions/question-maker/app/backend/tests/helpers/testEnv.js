/**
 * Single source of truth for where the test `.env` lives.
 *
 * Both `globalSetup.js` (main process, before any test file) and `setup.js`
 * (each worker, before the test files it runs) need the same file, and they used
 * to compute the path independently from different bases. That divergence is how
 * #1368 hid: `globalSetup` was one level too high, landed on `apps/extensions/`
 * where there is no `.env`, and silently turned the up-front migrate into a
 * no-op, while `setup.js` resolved correctly and kept integration runs working.
 * One export, one path, so the next layout move breaks both or neither.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** `apps/extensions/question-maker/.env` — the extension root, not the repo root. */
export const TEST_ENV_PATH = resolve(__dirname, '../../../../.env');

/** Loads the extension `.env` into `process.env`. Missing file is not an error. */
export function loadTestEnv() {
  dotenv.config({ path: TEST_ENV_PATH });
}
