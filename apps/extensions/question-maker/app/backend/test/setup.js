/**
 * Jest runs this file before any test file loads. Load root .env first, then apply test-only overrides.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnv });

// Integration tests: prefer a real Postgres (see TEST_PLAN.md).
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (!process.env.DATABASE_URL) {
  // CI and fresh clones have no .env; src/config/database.js still loads Sequelize at import time.
  // Default unit tests (health, 401s, verifyToken) never open a connection; a valid DSN is enough.
  process.env.DATABASE_URL =
    'postgresql://jest:jest@127.0.0.1:5432/jest_unit_stub';
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32bytes!!';
