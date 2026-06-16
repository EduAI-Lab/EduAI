import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(__dirname, '..');

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

function dbNameFromUrl(databaseUrl) {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!name) throw new Error('DATABASE_URL must include a database name');
  return name;
}

function ensureTestDatabase(dbName) {
  const env = { ...process.env, PGPASSWORD: 'postgres' };
  const quoted = `"${dbName.replace(/"/g, '""')}"`;
  const existsSql = `SELECT 1 FROM pg_database WHERE datname = '${dbName.replace(/'/g, "''")}'`;

  const tryShell = (cmd) => {
    try {
      execSync(cmd, { env, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };

  if (tryShell(
    `psql -h 127.0.0.1 -p 54321 -U postgres -tc "${existsSql}" | grep -q 1 || psql -h 127.0.0.1 -p 54321 -U postgres -c "CREATE DATABASE ${quoted}"`,
  )) {
    return;
  }

  if (tryShell(`createdb -h 127.0.0.1 -p 54321 -U postgres ${quoted}`)) {
    return;
  }

  // Windows often has no psql — use the dev Docker container when available.
  try {
    const out = execSync(
      `docker exec eduai-ai-tutor-db psql -U postgres -tc "${existsSql}"`,
      { encoding: 'utf8' },
    );
    if (!out.trim()) {
      execSync(`docker exec eduai-ai-tutor-db psql -U postgres -c "CREATE DATABASE ${quoted}"`, {
        stdio: 'pipe',
      });
    }
  } catch {
    // Database likely already exists — that's fine
  }
}

export async function setup() {
  config({ path: resolve(serverRoot, '.env.test'), override: true });

  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required in .env.test for integration tests');
  }

  // Windows Hyper-V can break `localhost` while 127.0.0.1 works (see docs/implementations/windows-dev-database.md).
  if (isWindows) {
    databaseUrl = databaseUrl.replace('@localhost:', '@127.0.0.1:');
  }

  ensureTestDatabase(dbNameFromUrl(databaseUrl));

  const prismaBin = findBin('prisma');

  execBin(prismaBin, ['migrate', 'deploy'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}
