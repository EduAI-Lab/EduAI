/**
 * Truncates every table in the `public` schema except `_prisma_migrations`.
 *
 * Excluding `_prisma_migrations` matters: wiping it makes Prisma forget which
 * migrations have already been applied. On the next startup, `prisma migrate
 * deploy` finds the tables already exist (nothing to baseline) but has no
 * history of having created them, and fails trying to reapply the init
 * migration against existing tables.
 *
 * Shared by `scripts/seedUnified.js` (dev/seed reset) and
 * `tests/helpers/testDb.js` (integration test reset) so the two never drift.
 */
export async function truncateAllTables(prisma) {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
