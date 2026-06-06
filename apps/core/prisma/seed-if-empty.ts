import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();
const count = await prisma.user.count();
await prisma.$disconnect();

if (count === 0) {
  console.log('[auto-seed] No data found, seeding core database...');
  execSync('npm run db:seed', { stdio: 'inherit' });
} else {
  console.log(`[auto-seed] Core database already has ${count} users, skipping seed.`);
}
