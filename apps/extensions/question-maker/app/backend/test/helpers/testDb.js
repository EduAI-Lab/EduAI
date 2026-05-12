/**
 * Test database utilities for integration tests (PostgreSQL).
 * Requires TEST_DATABASE_URL in .env (or env) so the suite never truncates a dev database by mistake.
 */
import { connectDatabase, sequelize } from '../../src/config/database.js';

/**
 * Wipes all application tables in dependency order. Only call against a dedicated test database.
 */
export async function truncateTestDatabase() {
  const dialect = sequelize.getDialect();
  if (dialect !== 'postgres') {
    throw new Error(`truncateTestDatabase only supports postgres, got: ${dialect}`);
  }
  await sequelize.query(
    'TRUNCATE users RESTART IDENTITY CASCADE;'
  );
}

/**
 * Connects and syncs schema (same as production app startup, without allowFailure).
 */
export async function connectTestDatabase() {
  await connectDatabase({ retryOnFailure: false, allowFailure: false });
}

export { sequelize };
