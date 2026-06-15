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
  const [tables] = await sequelize.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename != 'SequelizeMeta'`
  );
  if (tables.length === 0) return;
  const list = tables.map(r => `"${r.tablename}"`).join(', ');
  await sequelize.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Connects and syncs schema (same as production app startup, without allowFailure).
 */
export async function connectTestDatabase() {
  await connectDatabase({ retryOnFailure: false, allowFailure: false });
}

export { sequelize };
