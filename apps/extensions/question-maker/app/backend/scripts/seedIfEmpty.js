/**
 * Auto-seed hook for `npm run dev` (mirrors ai-tutor's seed-if-empty.ts):
 * seeds the dev database only the first time it's empty, so repeated
 * `npm run dev` runs don't wipe local changes via the destructive `npm run seed`.
 */
import { execSync } from 'child_process';
import { prisma } from '../src/config/database.js';

const count = await prisma.user.count();
await prisma.$disconnect();

if (count === 0) {
  console.log('[auto-seed] No data found, seeding Question Maker database...');
  execSync('npm run seed', { stdio: 'inherit' });
} else {
  console.log(`[auto-seed] Question Maker database already has ${count} users, skipping seed.`);
}
