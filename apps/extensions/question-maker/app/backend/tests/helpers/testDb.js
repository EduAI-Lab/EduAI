/**
 * Test database utilities for integration tests (PostgreSQL).
 * Requires TEST_DATABASE_URL in .env (or env) so the suite never truncates a dev database by mistake.
 */
import { connectDatabase, prisma } from '../../src/config/database.js';

/**
 * Wipes all application tables in dependency order. Only call against a dedicated test database.
 */
export async function truncateTestDatabase() {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
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
