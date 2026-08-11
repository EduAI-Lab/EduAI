import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(appDir, 'docker-compose.yml');
const password = process.env.POSTGRES_PASSWORD;

if (!password || password === 'postgres' || password.length < 16) {
  throw new Error('POSTGRES_PASSWORD must be a non-default secret of at least 16 characters');
}

const rendered = spawnSync(
  'docker',
  ['compose', '-f', composeFile, 'config', '--format', 'json'],
  {
    cwd: appDir,
    env: process.env,
    encoding: 'utf8',
  },
);

if (rendered.status !== 0) {
  throw new Error(`Unable to render AI Tutor Compose configuration: ${rendered.stderr.trim()}`);
}

const config = JSON.parse(rendered.stdout);
const database = config.services?.db;
if (!database) throw new Error('AI Tutor Compose must define the db service');
if (database.network_mode === 'host') throw new Error('AI Tutor database must not use host networking');
if (database.environment?.POSTGRES_PASSWORD !== password) {
  throw new Error('AI Tutor database password was not sourced from POSTGRES_PASSWORD');
}

const postgresPorts = (database.ports ?? []).filter((port) => Number(port.target) === 5432);
if (postgresPorts.length !== 1) {
  throw new Error('AI Tutor database must expose exactly one loopback-only host socket');
}

const [postgresPort] = postgresPorts;
if (
  postgresPort.host_ip !== '127.0.0.1' ||
  String(postgresPort.published) !== '54321'
) {
  throw new Error('AI Tutor PostgreSQL must bind only to 127.0.0.1:54321');
}

console.log('AI Tutor Compose database binding is loopback-only and secret-backed.');
