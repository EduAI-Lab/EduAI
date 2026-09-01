import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const aiTutorPkgRoot = resolve(repoRoot, "apps/extensions/ai-tutor/server");
const qmBackendPkgRoot = resolve(repoRoot, "apps/extensions/question-maker/app/backend");
const aiTutorClientPackage = "@eduai/ai-tutor-prisma-client";
const qmClientPackage = "@eduai/question-maker-prisma-client";

const aiTutorRequire = createRequire(resolve(aiTutorPkgRoot, "package.json"));
const qmRequire = createRequire(resolve(qmBackendPkgRoot, "package.json"));

let aiTutorClientPath;
let qmClientPath;

try {
  aiTutorClientPath = aiTutorRequire.resolve(aiTutorClientPackage);
} catch (err) {
  console.error(`FAIL: Could not resolve ${aiTutorClientPackage} from AI Tutor package root.`);
  console.error(`  Package root: ${aiTutorPkgRoot}`);
  console.error(`  Error: ${err.message}`);
  process.exitCode = 1;
}

try {
  qmClientPath = qmRequire.resolve(qmClientPackage);
} catch (err) {
  console.error(
    `FAIL: Could not resolve ${qmClientPackage} from Question Maker backend package root.`,
  );
  console.error(`  Package root: ${qmBackendPkgRoot}`);
  console.error(`  Error: ${err.message}`);
  process.exitCode = 1;
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`AI Tutor ${aiTutorClientPackage}  -> ${aiTutorClientPath}`);
console.log(`QM Backend ${qmClientPackage} -> ${qmClientPath}`);

if (aiTutorClientPath === qmClientPath) {
  console.error("");
  console.error(
    "FAIL: Both backends resolve the same generated Prisma Client. The clients are NOT isolated.",
  );
  console.error(`  Shared path: ${aiTutorClientPath}`);
  console.error("  Configure distinct @eduai/* output packages in both schemas and regenerate.");
  process.exit(1);
}

console.log("PASS: Backends resolve different generated Prisma Client paths.");

const { PrismaClient: AiTutorPrismaClient } = await import(pathToFileURL(aiTutorClientPath).href);
const { PrismaClient: QmPrismaClient } = await import(pathToFileURL(qmClientPath).href);

const aiTutorPrisma = new AiTutorPrismaClient();
const qmPrisma = new QmPrismaClient();

let failures = 0;

try {
  if (typeof aiTutorPrisma.aiInteractionTrace === "undefined") {
    console.error(
      "FAIL: AI Tutor PrismaClient is missing expected delegate `aiInteractionTrace`. " +
        "It may have received Question Maker models.",
    );
    failures++;
  } else {
    console.log("PASS: AI Tutor PrismaClient exposes aiInteractionTrace.");
  }

  if (typeof qmPrisma.user === "undefined") {
    console.error(
      "FAIL: Question Maker PrismaClient is missing expected delegate `user`. " +
        "It may have received AI Tutor models.",
    );
    failures++;
  } else {
    console.log("PASS: Question Maker PrismaClient exposes user.");
  }
} finally {
  await aiTutorPrisma.$disconnect();
  await qmPrisma.$disconnect();
}

// Each backend must reach Prisma through its own generated `@eduai/*` package.
// A bare `@prisma/client` import resolves to the hoisted npm stub (or, on a
// machine where another workspace happened to generate into it, to a foreign
// client), so it fails only in the deployment layouts — Docker startup, a fresh
// CI install — where it matters most.
const SOURCE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".tsx"];
const BARE_CLIENT_IMPORT = /(?:from|import|require\()\s*["'`]@prisma\/client(?:\/[^"'`]*)?["'`]/;

function* sourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(full);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

for (const [pkgRoot, clientPackage] of [
  [aiTutorPkgRoot, aiTutorClientPackage],
  [qmBackendPkgRoot, qmClientPackage],
]) {
  for (const subdir of ["src", "scripts", "tests"]) {
    for (const file of sourceFiles(resolve(pkgRoot, subdir))) {
      if (!BARE_CLIENT_IMPORT.test(readFileSync(file, "utf8"))) continue;
      console.error(
        `FAIL: ${relative(repoRoot, file)} imports "@prisma/client" directly. ` +
          `Import ${clientPackage} instead.`,
      );
      failures++;
    }
  }
}

if (failures === 0) {
  console.log("PASS: No backend source imports a bare @prisma/client.");
}

if (failures > 0) {
  console.error(`\n${failures} isolation check(s) failed.`);
  process.exit(1);
}

console.log("\nAll Prisma client isolation checks passed.");
