const { existsSync, copyFileSync } = require('fs');
const { execSync } = require('child_process');
const { resolve } = require('path');

const root = resolve(__dirname, '..');

const envPairs = [
  ['apps/core/.env.example', 'apps/core/.env'],
  ['apps/extensions/question-maker/.env.example', 'apps/extensions/question-maker/.env'],
  ['apps/extensions/ai-tutor/server/.env.example', 'apps/extensions/ai-tutor/server/.env'],
];

for (const [src, dest] of envPairs) {
  const destPath = resolve(root, dest);
  if (!existsSync(destPath)) {
    copyFileSync(resolve(root, src), destPath);
    console.log(`  created ${dest}`);
  }
}

// Generate core's Prisma client into its local node_modules so it doesn't
// conflict with the ai-tutor server client that lands in root node_modules.
try {
  execSync('npm run db:generate', { cwd: resolve(root, 'apps/core'), stdio: 'pipe' });
  console.log('  generated prisma client for apps/core');
} catch (e) {
  console.warn('  warning: prisma generate failed for apps/core:', e.message);
}
