import { beforeAll } from 'vitest';
import { resolveIntegrationTestDatabaseUrl } from './test-database-url';
import { seedTestDisciplines } from './helpers/disciplines';

// Load test env BEFORE any app imports so the Prisma singleton connects to the test DB
const url = resolveIntegrationTestDatabaseUrl();
if (!url.includes('connection_limit=')) {
  process.env.DATABASE_URL = url.includes('?')
    ? `${url}&connection_limit=1`
    : `${url}?connection_limit=1`;
}

// Many accept-flow tests sign up in quick succession; disable Better Auth's
// per-IP limiter so CI doesn't flake on the 4th+ sign-up in a file.
process.env.BETTER_AUTH_DISABLE_RATE_LIMIT = '1';

beforeAll(async () => {
  await seedTestDisciplines();
});
