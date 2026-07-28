import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const aiTutorPkgRoot = resolve(repoRoot, 'apps/extensions/ai-tutor/server');
const qmBackendPkgRoot = resolve(repoRoot, 'apps/extensions/question-maker/app/backend');

const aiTutorRequire = createRequire(resolve(aiTutorPkgRoot, 'package.json'));
const qmRequire = createRequire(resolve(qmBackendPkgRoot, 'package.json'));

let aiTutorClientPath;
let qmClientPath;

try {
  aiTutorClientPath = aiTutorRequire.resolve('@prisma/client');
} catch (err) {
  console.error('FAIL: Could not resolve @prisma/client from AI Tutor package root.');
  console.error(`  Package root: ${aiTutorPkgRoot}`);
  console.error(`  Error: ${err.message}`);
  process.exitCode = 1;
}

try {
  qmClientPath = qmRequire.resolve('@prisma/client');
} catch (err) {
  console.error('FAIL: Could not resolve @prisma/client from Question Maker backend package root.');
  console.error(`  Package root: ${qmBackendPkgRoot}`);
  console.error(`  Error: ${err.message}`);
  process.exitCode = 1;
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`AI Tutor @prisma/client  -> ${aiTutorClientPath}`);
console.log(`QM Backend @prisma/client -> ${qmClientPath}`);

if (aiTutorClientPath === qmClientPath) {
  console.error('');
  console.error(
    'FAIL: Both backends resolve the same @prisma/client. The generated clients are NOT isolated.',
  );
  console.error(`  Shared path: ${aiTutorClientPath}`);
  console.error(
    '  Add output = "../node_modules/@prisma/client" to each schema generator and regenerate.',
  );
  process.exit(1);
}

console.log('PASS: Backends resolve different @prisma/client paths.');

const { PrismaClient: AiTutorPrismaClient } = await import(pathToFileURL(aiTutorClientPath).href);
const { PrismaClient: QmPrismaClient } = await import(pathToFileURL(qmClientPath).href);

const aiTutorPrisma = new AiTutorPrismaClient();
const qmPrisma = new QmPrismaClient();

let failures = 0;

try {
  if (typeof aiTutorPrisma.aiInteractionTrace === 'undefined') {
    console.error(
      'FAIL: AI Tutor PrismaClient is missing expected delegate `aiInteractionTrace`. ' +
        'It may have received Question Maker models.',
    );
    failures++;
  } else {
    console.log('PASS: AI Tutor PrismaClient exposes aiInteractionTrace.');
  }

  if (typeof qmPrisma.user === 'undefined') {
    console.error(
      'FAIL: Question Maker PrismaClient is missing expected delegate `user`. ' +
        'It may have received AI Tutor models.',
    );
    failures++;
  } else {
    console.log('PASS: Question Maker PrismaClient exposes user.');
  }
} finally {
  await aiTutorPrisma.$disconnect();
  await qmPrisma.$disconnect();
}

if (failures > 0) {
  console.error(`\n${failures} isolation check(s) failed.`);
  process.exit(1);
}

console.log('\nAll Prisma client isolation checks passed.');
