import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();
const [userCount, studentsWithoutId] = await Promise.all([
  prisma.user.count(),
  prisma.user.count({ where: { role: 'STUDENT', studentId: null } }),
]);
await prisma.$disconnect();

if (userCount === 0) {
  console.log('[auto-seed] No data found, seeding core database...');
  execSync('npm run db:seed', { stdio: 'inherit' });
} else if (studentsWithoutId > 0) {
  console.log(`[auto-seed] ${studentsWithoutId} student(s) missing student ID — re-seeding to backfill...`);
  execSync('npm run db:seed', { stdio: 'inherit' });
} else {
  console.log(`[auto-seed] Core database already has ${userCount} users, skipping seed.`);
}
