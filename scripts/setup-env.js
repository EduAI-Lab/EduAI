const { existsSync, copyFileSync, readFileSync, appendFileSync } = require('fs');
const { execSync } = require('child_process');
const { resolve } = require('path');

const root = resolve(__dirname, '..');

const envPairs = [
  ['apps/core/.env.example', 'apps/core/.env'],
  ['apps/extensions/question-maker/.env.example', 'apps/extensions/question-maker/.env'],
  ['apps/extensions/ai-tutor/server/.env.example', 'apps/extensions/ai-tutor/server/.env'],
  ['apps/extensions/example-extension/.env.example', 'apps/extensions/example-extension/.env'],
  ['apps/core/.env.test.example', 'apps/core/.env.test'],
  ['apps/extensions/ai-tutor/server/.env.test.example', 'apps/extensions/ai-tutor/server/.env.test'],
];

/**
 * Parse an env file into a Set of defined key names.
 * Only looks at lines of the form KEY=... or KEY="...".
 */
function parsedKeys(filePath) {
  const keys = new Set();
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

for (const [src, dest] of envPairs) {
  const srcPath = resolve(root, src);
  const destPath = resolve(root, dest);

  if (!existsSync(destPath)) {
    copyFileSync(srcPath, destPath);
    console.log(`  created ${dest}`);
  } else {
    // Merge any keys present in .env.example but missing from the existing .env
    const existing = parsedKeys(destPath);
    const missing = [];
    for (const line of readFileSync(srcPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)\s*=/);
      if (m && !existing.has(m[1])) {
        missing.push(line);
      }
    }
    if (missing.length > 0) {
      appendFileSync(destPath, '\n# Added by setup-env.js (new keys from .env.example)\n' + missing.join('\n') + '\n');
      console.log(`  merged ${missing.length} new key(s) into ${dest}: ${missing.map(l => l.split('=')[0]).join(', ')}`);
    }
  }
}

// CI generates each workspace client explicitly in the job that consumes it. Skipping
// this implicit generation there avoids doing the same work during npm ci and again
// before typechecking/tests, while preserving the convenient local-install behavior.
if (process.env.SKIP_PRISMA_GENERATE !== '1') {
  try {
    execSync('npm run db:generate', { cwd: resolve(root, 'apps/core'), stdio: 'pipe' });
    console.log('  generated prisma client for apps/core');
  } catch (e) {
    console.warn('  warning: prisma generate failed for apps/core:', e.message);
  }
} else {
  console.log('  skipped prisma client generation (SKIP_PRISMA_GENERATE=1)');
}
