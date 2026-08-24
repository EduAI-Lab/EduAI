import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedClientDir = resolve(repoRoot, "apps/core/node_modules/@prisma/client");
let generatedClientBackup = null;

// Core intentionally writes its generated client into its workspace-local
// node_modules. After the first generation that output shadows the real root
// `@prisma/client` provider package, so Prisma cannot resolve its generator on
// the next run. Quarantine only the recognisable generated package while the
// CLI resolves the real provider, then discard the backup after a successful
// atomic replacement (or restore it if generation fails).
try {
  const packageJsonPath = resolve(generatedClientDir, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageName = JSON.parse(readFileSync(packageJsonPath, "utf8")).name;
    if (typeof packageName === "string" && packageName.startsWith("prisma-client-")) {
      generatedClientBackup = `${generatedClientDir}.generate-backup-${process.pid}`;
      if (existsSync(generatedClientBackup)) {
        throw new Error(
          `Refusing to overwrite an existing Prisma backup: ${generatedClientBackup}`,
        );
      }
      renameSync(generatedClientDir, generatedClientBackup);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const result = spawnSync(process.execPath, [prismaCli, "generate", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    // Prisma's CLI otherwise edits package.json and installs a nested client when
    // npm's workspace layout does not place @prisma/client beside this schema.
    PRISMA_GENERATE_SKIP_AUTOINSTALL: "true",
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  restoreGeneratedClient();
  process.exit(1);
}

if (result.status === 0) {
  if (generatedClientBackup) {
    rmSync(generatedClientBackup, { recursive: true, force: true });
  }
  process.exit(0);
}

restoreGeneratedClient();
process.exit(result.status ?? 1);

function restoreGeneratedClient() {
  if (!generatedClientBackup || !existsSync(generatedClientBackup)) return;
  if (existsSync(generatedClientDir)) {
    rmSync(generatedClientDir, { recursive: true, force: true });
  }
  renameSync(generatedClientBackup, generatedClientDir);
}
