/**
 * Baselines a pre-Prisma (Sequelize-managed) database before `prisma migrate deploy`
 * runs. Sequelize brought QM's schema up via `sequelize.sync({ alter: true })`
 * (src/config/database.js, pre-migration) — there was never a migrations table, so
 * an existing production/staging database already has `users`, `courses`, etc.
 * `prisma migrate deploy` would try to CREATE TABLE them again via
 * 20260723215902_init and fail before the server ever starts.
 *
 * Detection: no `_prisma_migrations` table yet.
 *   - `users` table also absent  -> genuinely fresh database. No-op; `migrate deploy`
 *     runs init (and everything after it) from scratch as normal.
 *   - `users` table present      -> pre-existing Sequelize database. Mark
 *     20260723215902_init as already applied (`prisma migrate resolve --applied`)
 *     WITHOUT running its DDL, since Sequelize already created those tables. Every
 *     migration after init (the Practice Exam unique index, the canvas-mapping/
 *     question_order adoption migration) still runs for real via the normal
 *     `migrate deploy` that follows this script — that's what reconciles the
 *     baselined data with what a fresh init.sql would have produced.
 *
 * Idempotent: once `_prisma_migrations` exists (baselined or fresh), this is a
 * no-op on every subsequent deploy.
 */
import { spawnSync } from 'child_process';
import { prisma } from '../src/config/database.js';

const INIT_MIGRATION = '20260723215902_init';

async function tableExists(tableName) {
  const rows = await prisma.$queryRaw`
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ${tableName}
  `;
  return rows.length > 0;
}

async function main() {
  const alreadyTracked = await tableExists('_prisma_migrations');
  if (alreadyTracked) {
    console.log('[baseline] _prisma_migrations already present, nothing to baseline.');
    return;
  }

  const preExisting = await tableExists('users');
  if (!preExisting) {
    console.log('[baseline] No prior schema found, nothing to baseline (fresh database).');
    return;
  }

  console.log(`[baseline] Pre-existing Sequelize-managed database detected. Resolving ${INIT_MIGRATION} as applied...`);
  const result = spawnSync('npx', ['prisma', 'migrate', 'resolve', '--applied', INIT_MIGRATION], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`prisma migrate resolve --applied ${INIT_MIGRATION} failed (exit ${result.status})`);
  }

  console.log('[baseline] Baseline complete. Remaining migrations will apply normally.');
}

main()
  .catch((error) => {
    console.error('[baseline] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
