import { vi } from 'vitest';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Keep test output clean: the app logs intentional error paths via console.error/warn
// (e.g. supervisor verdict-parse fallback, manual enrollment-sync failures) that several
// tests deliberately exercise. Silence them during tests; run with TEST_VERBOSE=1 to restore.
if (!process.env.TEST_VERBOSE) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}

// Load .env.test BEFORE any app imports so the Prisma singleton connects to the test DB
config({ path: resolve(__dirname, '..', '.env.test'), override: true });

// Force connection_limit=1 in the DATABASE_URL to prevent Prisma pool races.
// This ensures all queries go through a single connection, serializing all
// DB operations and eliminating FK-violation flakiness in test setup/teardown.
const url = process.env.DATABASE_URL || '';
if (!url.includes('connection_limit=')) {
  process.env.DATABASE_URL = url.includes('?')
    ? `${url}&connection_limit=1`
    : `${url}?connection_limit=1`;
}
