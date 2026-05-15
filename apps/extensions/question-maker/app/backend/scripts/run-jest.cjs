'use strict';

const { spawnSync } = require('child_process');

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(
  process.execPath,
  ['--experimental-vm-modules', jestBin, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
