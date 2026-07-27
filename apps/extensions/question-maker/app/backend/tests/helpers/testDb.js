/**
 * Test database utilities for integration tests (PostgreSQL).
 * Requires TEST_DATABASE_URL in .env (or env) so the suite never truncates a dev database by mistake.
 */
import { connectDatabase, prisma } from '../../src/config/database.js';
import { truncateAllTables } from '../../src/utils/truncateAllTables.js';

/**
 * Wipes all application tables in dependency order. Only call against a dedicated test database.
 */
export async function truncateTestDatabase() {
  await truncateAllTables(prisma);
}

/**
 * Connects (same as production app startup, without allowFailure). Migrations
 * are applied out-of-band by `tests/globalSetup.js` (`prisma migrate deploy`),
 * not here.
 */
export async function connectTestDatabase() {
  await connectDatabase({ retryOnFailure: false, allowFailure: false });
}

export { prisma };
