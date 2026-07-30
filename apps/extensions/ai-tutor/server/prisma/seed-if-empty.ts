import { PrismaClient } from '../generated/prisma/index.js';
import { execSync } from 'child_process';

const prisma = new PrismaClient();
const count = await prisma.promptTemplate.count();
await prisma.$disconnect();

if (count === 0) {
  console.log('[auto-seed] No data found, seeding AI Tutor database...');
  execSync('npm run seed', { stdio: 'inherit' });
} else {
  console.log(`[auto-seed] AI Tutor database already has ${count} prompt templates, skipping seed.`);
}
