'use strict';
// Cross-platform port of scripts/dev-db.sh
const { execSync } = require('node:child_process');

function run(cmd, opts) {
  return execSync(cmd, Object.assign({ stdio: 'inherit' }, opts));
}

function dockerRunning() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!dockerRunning()) {
    if (process.platform === 'darwin') {
      console.log('Docker not running — starting Docker Desktop...');
      run('open -a Docker');
      process.stdout.write('Waiting for Docker');
      while (!dockerRunning()) {
        process.stdout.write('.');
        await sleep(2000);
      }
      console.log(' ready.');
    } else {
      console.error(
        'Error: Docker is not running. Please start Docker and re-run "npm run dev".',
      );
      process.exit(1);
    }
  }

  try {
    run('docker compose -f docker-compose.dev.yml down --remove-orphans');
  } catch {}

  // Remove any containers still bound to the DB ports
  const dbPorts = [
    process.env.CORE_DB_PORT || '54320',
    process.env.TUTOR_DB_PORT || '54321',
    process.env.QM_DB_PORT || '55432',
  ];
  for (const port of dbPorts) {
    try {
      const ids = execSync(`docker ps -q --filter "publish=${port}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (ids) {
        console.log(`Removing container(s) still bound to port ${port}...`);
        run(`docker rm -f ${ids}`);
      }
    } catch {}
  }

  try {
    run('docker network rm eduai-dev');
  } catch {}

  run(
    'docker compose -f docker-compose.dev.yml up -d --wait eduai-db ai-tutor-db question-maker-db',
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
