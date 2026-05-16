import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(__dirname, '..');

// Walk up from serverRoot until we find node_modules/.bin/<name>
const isWindows = process.platform === 'win32';

function findBin(name) {
  const binName = isWindows ? `${name}.cmd` : name;
  let dir = serverRoot;
  const { root } = parse(dir);
  while (dir !== root) {
    const bin = resolve(dir, 'node_modules', '.bin', binName);
    if (existsSync(bin)) return bin;
    dir = resolve(dir, '..');
  }
  throw new Error(`Could not find ${name} binary. Make sure it is installed.`);
}

function execBin(bin, args, opts) {
  if (isWindows) {
    return execFileSync('cmd.exe', ['/c', bin, ...args], opts);
  }
  return execFileSync(bin, args, opts);
}

export async function setup() {
  // Load test env so DATABASE_URL points to the test database
  config({ path: resolve(serverRoot, '.env.test'), override: true });

  // Create the test database if it doesn't exist
  try {
    execSync(
      'psql -h localhost -p 54321 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = \'aitutor_test\'" | grep -q 1 || psql -h localhost -p 54321 -U postgres -c "CREATE DATABASE aitutor_test"',
      { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'pipe' },
    );
  } catch {
    // If psql is not available, try via createdb
    try {
      execSync('createdb -h localhost -p 54321 -U postgres aitutor_test', {
        env: { ...process.env, PGPASSWORD: 'postgres' },
        stdio: 'pipe',
      });
    } catch {
      // Database likely already exists — that's fine
    }
  }

  const prismaBin = findBin('prisma');

  // Generates the Prisma client before running migrations
  execBin(prismaBin, ['generate'], {
    cwd: serverRoot,
    env: { ...process.env },
    stdio: 'pipe',
  });

  execBin(prismaBin, ['migrate', 'deploy'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
}
