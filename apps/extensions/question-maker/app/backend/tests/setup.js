/**
 * Vitest runs this file before any test file loads. Load root .env first, then apply test-only overrides.
 */
import { loadTestEnv } from './helpers/testEnv.js';

loadTestEnv();

// Integration tests: prefer a real Postgres (see TEST_PLAN.md).
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (!process.env.DATABASE_URL) {
  // CI and fresh clones have no .env; src/config/database.js requires DATABASE_URL to be
  // set at import time (PrismaClient itself connects lazily on first query, not at
  // construction, but the explicit check in database.js still needs a value).
  // Default unit tests (health, 401s, verifyToken) never open a connection; a valid DSN is enough.
  process.env.DATABASE_URL =
    'postgresql://vitest:vitest@127.0.0.1:5432/vitest_unit_stub';
}

process.env.CORE_URL = process.env.CORE_URL || 'http://localhost:3000';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32bytes!!';
