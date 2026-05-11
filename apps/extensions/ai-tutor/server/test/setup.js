import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.test BEFORE any app imports so the Prisma singleton connects to the test DB
config({ path: resolve(__dirname, '..', '.env.test'), override: true });

// Force connection_limit=1 in the DATABASE_URL to prevent Prisma pool races.
// This ensures all queries go through a single connection, serializing all
// DB operations and eliminating FK-violation flakiness in test setup/teardown.
const url = process.env.DATABASE_URL || '';
if (!url.includes('connection_limit=')) {
  process.env.DATABASE_URL = url.includes('?')
    ? `${url}&connection_limit=1`
    : `${url}?connection_limit=1`;
}
