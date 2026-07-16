/**
 * Idempotent backfill: default "Course bank" per course + memberships for orphan questions.
 * Usage: node scripts/backfillDefaultQuestionBanks.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../../../');
const envPath = join(projectRoot, '.env');

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

if (process.env.DATABASE_URL?.includes('@postgres:') && !process.env.DOCKER) {
  const hostPort = process.env.POSTGRES_HOST_PORT || '55432';
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    '@postgres:5432',
    `@localhost:${hostPort}`
  );
}

async function main() {
  const { connectDatabase, sequelize } = await import('../src/config/database.js');
  await import('../src/schema/index.js');
  const { backfillDefaultBanks } = await import('../src/services/questionBankService.js');

  await connectDatabase({ retryOnFailure: false, allowFailure: false });
  await sequelize.sync({ alter: true });

  const result = await backfillDefaultBanks();
  console.log('Backfill complete:', result);
  await sequelize.close();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
