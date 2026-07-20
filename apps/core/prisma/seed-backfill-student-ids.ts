import { prisma, seedUsers } from './seed';

console.log('[auto-seed] Backfilling seed student IDs (10000001–10000005)...');

try {
  await seedUsers();
  console.log('[auto-seed] Seed student IDs backfilled.');
} catch (error) {
  console.error('[auto-seed] Student ID backfill failed:', error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
