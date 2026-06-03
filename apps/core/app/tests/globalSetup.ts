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
  const parsedUrl = new URL(dbUrl);
  const dbName = parsedUrl.pathname.replace(/^\//, '').split('?')[0];
  const dbUser = decodeURIComponent(parsedUrl.username);
  const dbPassword = decodeURIComponent(parsedUrl.password);
  const dbHost = parsedUrl.hostname || 'localhost';
  const pgEnv = { ...process.env, PGPASSWORD: dbPassword };

  // Ensure the test database exists
  try {
    execSync(
      `psql -h ${dbHost} -U ${dbUser} -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'" | grep -q 1 || psql -h ${dbHost} -U ${dbUser} -c "CREATE DATABASE \\"${dbName}\\""`,
      { env: pgEnv, stdio: 'pipe' },
    );
  } catch {
    // psql not on PATH or DB already exists — try createdb as fallback
    try {
      execSync(`createdb -h ${dbHost} -U ${dbUser} "${dbName}"`, {
        env: pgEnv,
        stdio: 'pipe',
      });
    } catch {
      // Already exists — fine
    }
  }

  // Enable pgvector extension (idempotent).
  // Try psql directly first; fall back to docker exec for Windows where psql is often not in PATH.
  let vectorEnabled = false;
  try {
    execSync(`psql -h ${dbHost} -U ${dbUser} -d "${dbName}" -c "CREATE EXTENSION IF NOT EXISTS vector;"`, {
      env: pgEnv,
      stdio: 'pipe',
    });
    vectorEnabled = true;
  } catch {}

  if (!vectorEnabled) {
    try {
      execSync(
        `docker exec eduai-db psql -U ${dbUser} -d "${dbName}" -c "CREATE EXTENSION IF NOT EXISTS vector;"`,
        { stdio: 'pipe' },
      );
    } catch {
      // If both fail, db push below will surface the error
    }
  }

  const prismaBin = findBin('prisma');

  // Sync schema to test DB (idempotent, no migration history needed)
  execBin(prismaBin, ['db', 'push', '--accept-data-loss'], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
  });
}
