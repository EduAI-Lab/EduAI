import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { SEED_IDS } from './seed';

const prisma = new PrismaClient();

const SEED_STUDENT_IDS = [
  SEED_IDS.users.student1,
  SEED_IDS.users.student2,
  SEED_IDS.users.student3,
  SEED_IDS.users.student4,
  SEED_IDS.users.student5,
];

const [userCount, seedStudentsNeedingBackfill] = await Promise.all([
  prisma.user.count(),
  prisma.user.count({
    where: {
      id: { in: [...SEED_STUDENT_IDS] },
      OR: [{ studentId: null }, { studentIdLookup: null }],
    },
  }),
]);
await prisma.$disconnect();

if (userCount === 0) {
  console.log('[auto-seed] No data found, seeding core database...');
  execSync('npm run db:seed', { stdio: 'inherit' });
} else if (seedStudentsNeedingBackfill > 0) {
  console.log(
    `[auto-seed] ${seedStudentsNeedingBackfill} seed student(s) need student ID backfill — running targeted update...`,
  );
  execSync('tsx prisma/seed-backfill-student-ids.ts', { stdio: 'inherit' });
} else {
  console.log(`[auto-seed] Core database already has ${userCount} users, skipping seed.`);
}
