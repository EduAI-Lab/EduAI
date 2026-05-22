import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..', '..'); // apps/core

const isWindows = process.platform === 'win32';

function findBin(name: string): string {
  const binName = isWindows ? `${name}.cmd` : name;
  let dir = appRoot;
  const { root } = parse(dir);
  while (dir !== root) {
    const bin = resolve(dir, 'node_modules', '.bin', binName);
    if (existsSync(bin)) return bin;
    dir = resolve(dir, '..');
  }
  throw new Error(`Could not find ${name} binary. Make sure it is installed.`);
}

function execBin(bin: string, args: string[], opts: object): void {
  if (isWindows) {
    execFileSync('cmd.exe', ['/c', bin, ...args], opts);
  } else {
    execFileSync(bin, args, opts);
  }
}

export async function setup() {
  // Load .env.test so DATABASE_URL points at the test database
  config({ path: resolve(appRoot, '.env.test'), override: true });

  const dbUrl = process.env.DATABASE_URL ?? '';

  // Extract DB name from the URL (last path segment before any '?')
  const dbName = new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0];

  // Ensure the test database exists
  try {
    execSync(
      `psql -h localhost -U eduai -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'" | grep -q 1 || psql -h localhost -U eduai -c "CREATE DATABASE \\"${dbName}\\""`,
      { env: { ...process.env, PGPASSWORD: 'eduai_password' }, stdio: 'pipe' },
    );
  } catch {
    // psql not on PATH or DB already exists — try createdb as fallback
    try {
      execSync(`createdb -h localhost -U eduai "${dbName}"`, {
        env: { ...process.env, PGPASSWORD: 'eduai_password' },
        stdio: 'pipe',
      });
    } catch {
      // Already exists — fine
    }
  }

  // Enable pgvector extension (idempotent)
  try {
    execSync(`psql -h localhost -U eduai -d "${dbName}" -c "CREATE EXTENSION IF NOT EXISTS vector;"`, {
      env: { ...process.env, PGPASSWORD: 'eduai_password' },
      stdio: 'pipe',
    });
  } catch {
    // Extension already enabled or psql unavailable — db push will surface real errors
  }

  const prismaBin = findBin('prisma');

  // Sync schema to test DB (idempotent, no migration history needed)
  execBin(prismaBin, ['db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
  });
}
