import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.test BEFORE any app imports so the Prisma singleton connects to the test DB
config({ path: resolve(__dirname, '..', '..', '.env.test'), override: true });

// Serialize all DB operations through a single connection to avoid FK-race flakiness
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('connection_limit=')) {
  process.env.DATABASE_URL = url.includes('?')
    ? `${url}&connection_limit=1`
    : `${url}?connection_limit=1`;
}
