import { execSync, execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(__dirname, '..');

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

  // Run migrations against the test database using the LOCAL prisma binary.
  // Use execFileSync to avoid shell interpretation issues with paths
  // containing special characters (e.g. apostrophes in directory names).
  const prismaBin = resolve(serverRoot, 'node_modules', '.bin', 'prisma');
  execFileSync(prismaBin, ['migrate', 'deploy'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
}
