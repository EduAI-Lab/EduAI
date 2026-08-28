/**
 * Smoke test for the one-shot Canvas→Core credential copier. The Docker startup
 * path (`Dockerfile` CMD) and `db:migrate:deploy` both invoke this script before
 * `prisma migrate deploy` renames `canvas_integrations` away, so the script must
 * at minimum load and run under the client this workspace actually generates
 * (`@eduai/question-maker-prisma-client`, not the hoisted `@prisma/client` stub).
 *
 * Running with both database URLs blanked exercises the whole module graph —
 * Prisma client, dotenv, cuid2, the re-encryption helper — without needing a
 * database: the script logs its skip notice and exits 0.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = resolve(backendRoot, "scripts/migrate-canvas-integrations-to-core.mjs");

function runCopier(extraEnv) {
  return spawnSync(process.execPath, [scriptPath, "--dry-run"], {
    cwd: backendRoot,
    // Empty (not absent) values: the script's dotenv load runs with
    // `override: false`, so a defined key keeps a repo `.env` from supplying a
    // real database URL here.
    env: {
      ...process.env,
      DATABASE_URL: "",
      QUESTION_MAKER_DATABASE_URL: "",
      CORE_DATABASE_URL: "",
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

describe("migrate-canvas-integrations-to-core CLI", () => {
  it("loads its Prisma client and exits 0 when no QM database is configured", () => {
    const result = runCopier();
    expect(`${result.stdout}${result.stderr}`).toContain("Skipping canvas→Core migration");
    expect(result.status).toBe(0);
  });
});
