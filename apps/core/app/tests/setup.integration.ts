import { resolveIntegrationTestDatabaseUrl } from './test-database-url';
import { beforeAll } from 'vitest';
import { seedTestDisciplines } from './helpers/disciplines';

// Load test env BEFORE any app imports so the Prisma singleton connects to the test DB
const url = resolveIntegrationTestDatabaseUrl();
if (!url.includes('connection_limit=')) {
  process.env.DATABASE_URL = url.includes('?')
    ? `${url}&connection_limit=1`
    : `${url}?connection_limit=1`;
}

beforeAll(async () => {
  await seedTestDisciplines();
});
