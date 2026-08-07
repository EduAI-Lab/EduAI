/**
 * Shared helper for invoking the local `prisma` CLI from Node (not npx, so it
 * works without network access) — used by globalSetup and by tests that need
 * to simulate a real app restart (`prisma migrate deploy` against the test DB).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, parse } from 'node:path';

const isWindows = process.platform === 'win32';

function findPrismaBin(startDir) {
  const binName = isWindows ? 'prisma.cmd' : 'prisma';
  let dir = startDir;
  const { root } = parse(dir);
  while (dir !== root) {
    const bin = resolve(dir, 'node_modules', '.bin', binName);
    if (existsSync(bin)) return bin;
    dir = resolve(dir, '..');
  }
  throw new Error('Could not find prisma binary. Make sure it is installed.');
}

/**
 * Runs `prisma migrate deploy` against `databaseUrl`, with `cwd` as the
 * backend root (where prisma/schema.prisma lives). Throws if it fails.
 */
export function runPrismaMigrateDeploy({ cwd, databaseUrl }) {
  const prismaBin = findPrismaBin(cwd);
  const execArgs = isWindows
    ? ['cmd.exe', ['/c', prismaBin, 'migrate', 'deploy']]
    : [prismaBin, ['migrate', 'deploy']];

  execFileSync(...execArgs, {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}
