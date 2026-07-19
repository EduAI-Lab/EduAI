/**
 * Migration script for #1072 §4 step 10 (final QM schema alignment): drops the
 * columns that are now fully superseded by Core read-through:
 *   - courses.name
 *   - courses.code
 *   - assessments.semester
 *
 * QM has no migration framework — it boots with `sequelize.sync({ alter: true })`
 * (src/config/database.js), which adds missing columns but never drops extra
 * ones. The model definitions for `Course`/`Assessments` already dropped these
 * fields (src/schema/Course.js, src/schema/Assessments.js) in the same commit as
 * this script, so `sync({ alter: true })` will not resurrect them after this runs.
 *
 * Idempotent: every operation checks `information_schema`/`pg_indexes` first, so
 * running this script twice (or against a DB that never had the columns) is a
 * no-op the second time. Order matters — dependent indexes/constraints on a
 * column are dropped before the column itself; see `dropColumnIfExists`.
 *
 * Usage:
 *   - host, from project root:  npm run migrate:1072 --prefix app/backend
 *   - host, from app/backend:   node scripts/migrate1072AnchorCleanup.js
 *   - Docker (deployed image):  docker compose exec <qm-backend-service> \
 *                                 node scripts/migrate1072AnchorCleanup.js
 *     e.g. `e2e-qm-server` in docker-compose.e2e.yml. Compose supplies
 *     DATABASE_URL as an environment variable and mounts no .env file —
 *     see env resolution below.
 */

// CRITICAL: Load environment variables FIRST before any imports that depend on them
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Env resolution: an already-set DATABASE_URL wins (the Docker image gets it
// from Compose and does not mount a .env — resolving `../../../.env` from
// /app/scripts would look for /.env and abort). The repo-root .env is only a
// fallback for host runs.
if (!process.env.DATABASE_URL) {
  const projectRoot = join(__dirname, '../../../');
  const envPath = join(projectRoot, '.env');

  if (!existsSync(envPath)) {
    console.error('❌ Error: DATABASE_URL is not set and no .env file was found!');
    console.error(`   Looked for: ${envPath}`);
    console.error('   Set DATABASE_URL in the environment, or create the .env file.');
    process.exit(1);
  }

  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('❌ Error loading .env file:', result.error.message);
    process.exit(1);
  }
}

if (!process.env.DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL is not set (checked environment and .env file)');
  process.exit(1);
}

// If running on host (not in Docker), use localhost and host-published port (default 55432)
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@postgres:')) {
  const isDocker = process.env.DOCKER === 'true' || process.env.COMPOSE_PROJECT_NAME;
  if (!isDocker) {
    const hostPort = process.env.POSTGRES_HOST_PORT || '55432';
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@postgres:5432', `@localhost:${hostPort}`);
  }
}

// Import database module (schema import intentionally skipped — this script
// operates on raw table/column names via SQL, independent of the current
// model definitions, so it stays correct even if a future model changes the
// column set again).
const dbModule = await import('../src/config/database.js');
const { sequelize } = dbModule;

/** Column drop plan: one entry per (table, column) pair, in execution order. */
const COLUMNS_TO_DROP = [
  { table: 'courses', column: 'name' },
  { table: 'courses', column: 'code' },
  { table: 'assessments', column: 'semester' },
];

/** True if `table.column` currently exists (idempotency check before any DDL). */
async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = :table AND column_name = :column`,
    { replacements: { table, column } }
  );
  return rows.length > 0;
}

/**
 * Drops any non-primary-key index whose definition references `column` on
 * `table`, ahead of dropping the column itself. Postgres would refuse (or
 * silently cascade, for a bare `DROP COLUMN`) — being explicit here means the
 * script's console output shows exactly what dependent objects it removed,
 * and nothing is left behind if a future column-drop is added without an
 * index cleanup step. No known index currently targets `name`/`code`/
 * `semester` (verified against the live schema), so this is defensive.
 */
async function dropDependentIndexes(table, column) {
  const [rows] = await sequelize.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = :table
       AND indexdef ~* ('\\m' || :column || '\\M')
       AND indexname !~ '_pkey$'`,
    { replacements: { table, column } }
  );

  for (const row of rows) {
    console.log(`  🔗 Dropping dependent index "${row.indexname}" on ${table}.${column}...`);
    await sequelize.query(`DROP INDEX IF EXISTS "${row.indexname}"`);
  }

  return rows.length;
}

/** Drops `table.column` if present, after clearing any dependent indexes. Idempotent. */
async function dropColumnIfExists(table, column) {
  if (!(await columnExists(table, column))) {
    console.log(`  ⏭️  ${table}.${column} already absent — skipping (idempotent).`);
    return { dropped: false, indexesDropped: 0 };
  }

  const indexesDropped = await dropDependentIndexes(table, column);

  console.log(`  🗑️  Dropping ${table}.${column}...`);
  await sequelize.query(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
  console.log(`  ✅ Dropped ${table}.${column}.`);

  return { dropped: true, indexesDropped };
}

const migrate = async () => {
  try {
    console.log('🔌 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connection established.');

    console.log('\n📋 Plan: drop courses.name, courses.code, assessments.semester');
    console.log('   (each column checked via information_schema first — safe to re-run.)\n');

    let totalDropped = 0;
    let totalIndexesDropped = 0;

    for (const { table, column } of COLUMNS_TO_DROP) {
      const { dropped, indexesDropped } = await dropColumnIfExists(table, column);
      if (dropped) totalDropped += 1;
      totalIndexesDropped += indexesDropped;
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   ✅ Columns dropped: ${totalDropped}`);
    console.log(`   🔗 Dependent indexes dropped: ${totalIndexesDropped}`);
    console.log(`   ⏭️  Already absent (no-op): ${COLUMNS_TO_DROP.length - totalDropped}`);

    console.log('\n✅ Migration completed successfully!');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await sequelize.close();
    process.exit(1);
  }
};

migrate();
