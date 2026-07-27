/**
 * Regression for a seed/restart bug: `truncateAllTables()` used to truncate
 * every table in `public`, including `_prisma_migrations`. On the first
 * `npm run dev` against an empty database, migrations apply and
 * `seed:if-empty` then wiped that history away. On the *next* startup,
 * baselining no-ops (the tables already exist) and `prisma migrate deploy`
 * has no record of having applied them, so it tries to reapply the init
 * migration against existing tables and fails — the app can never start
 * again without manual intervention.
 *
 * This drives the shared helper (src/utils/truncateAllTables.js, used by both
 * `scripts/seedUnified.js` and `tests/helpers/testDb.js`) exactly as the seed
 * script does, then replays a real `prisma migrate deploy` against the same
 * database to prove a restart actually succeeds afterward.
 *
 * Requires TEST_DATABASE_URL (skips otherwise, same as the other DB suites).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runPrismaMigrateDeploy } from '../helpers/prismaCli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '../..');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('seed truncation preserves Prisma migration history', () => {
  let connectTestDatabase, truncateTestDatabase, prisma, truncateAllTables;

  beforeAll(async () => {
    ({ connectTestDatabase, truncateTestDatabase, prisma } = await import('../helpers/testDb.js'));
    ({ truncateAllTables } = await import('../../src/utils/truncateAllTables.js'));
    await connectTestDatabase();
    await truncateTestDatabase();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('leaves _prisma_migrations intact while clearing application tables', async () => {
    await prisma.user.create({
      data: { id: 'seed-history-user', email: 'seed-history@test.com', name: 'Seed History Tester' },
    });

    const before = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations"`;
    expect(before[0].count).toBeGreaterThan(0);

    await truncateAllTables(prisma);

    const after = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations"`;
    expect(after[0].count).toBe(before[0].count);

    const userCount = await prisma.user.count();
    expect(userCount).toBe(0);
  });

  it('survives a simulated restart (prisma migrate deploy re-run) after seeding', async () => {
    await truncateAllTables(prisma);

    expect(() =>
      runPrismaMigrateDeploy({ cwd: backendRoot, databaseUrl: process.env.TEST_DATABASE_URL }),
    ).not.toThrow();
  });
});
