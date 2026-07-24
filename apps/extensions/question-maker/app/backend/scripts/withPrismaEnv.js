/**
 * Runs `npx prisma <args>` with DATABASE_URL loaded from the extension-root .env
 * (apps/extensions/question-maker/.env), since that file isn't colocated with
 * prisma/schema.prisma the way it is for ai-tutor/core and the Prisma CLI's own
 * dotenv resolution only looks in the schema dir / cwd. No-ops silently when the
 * .env file is absent (Docker/CI, where DATABASE_URL is already a real env var).
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../../../.env');

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const result = spawnSync('npx', ['prisma', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
