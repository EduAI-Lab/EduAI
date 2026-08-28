#!/usr/bin/env node
/**
 * One-shot migration: copy QM Canvas integrations into Core when Core has no row
 * for that userId. Decrypts with the QM ENCRYPTION_KEY and re-encrypts with Core's
 * ENCRYPTION_KEY (documented as separate keys in docs/ENVIRONMENT.md).
 *
 * Required when QM still has credential rows:
 *   QUESTION_MAKER_DATABASE_URL — QM Postgres (or DATABASE_URL from QM .env)
 *   CORE_DATABASE_URL — Core Postgres (or DATABASE_URL from Core .env)
 *   QM_ENCRYPTION_KEY / ENCRYPTION_KEY from QM .env
 *   CORE_ENCRYPTION_KEY / ENCRYPTION_KEY from Core .env
 *
 * Optional:
 *   --dry-run — print planned actions without writing to Core
 *
 * Deploy: run BEFORE QM `prisma migrate deploy` (see docs/DEPLOYMENT.md and
 * infra/s378/go-live-build.sh). The QM migration renames the source table to a
 * backup instead of dropping it immediately so a missed copy does not destroy tokens.
 *
 * Usage:
 *   npm run db:migrate:canvas-to-core -w question-maker-backend
 *   npm run db:migrate:canvas-to-core -w question-maker-backend -- --dry-run
 */
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createId } from "@paralleldrive/cuid2";
import { PrismaClient } from "@eduai/question-maker-prisma-client";
import { reencryptCanvasApiKey } from "./lib/canvasCredentialReencrypt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const qmEnvPath = join(__dirname, "../../../.env");
const coreEnvPath = join(__dirname, "../../../../../core/.env");

function loadEnv(path) {
  if (!existsSync(path)) return;
  dotenv.config({ path, override: false });
}

const dryRun = process.argv.includes("--dry-run");

function requireValue(value, name) {
  if (!value) {
    console.error(`Missing ${name}. Set it in the environment or the corresponding .env file.`);
    process.exit(1);
  }
  return value;
}

function createClient(url) {
  return new PrismaClient({
    datasources: { db: { url } },
  });
}

async function readQmIntegrations(qm) {
  const tables = ["canvas_integrations", "canvas_integrations_pre_core_backup"];
  for (const table of tables) {
    try {
      const rows = await qm.$queryRawUnsafe(`
        SELECT user_id, canvas_url, api_key, is_test_mode, created_at, updated_at
        FROM "${table}"
        ORDER BY user_id
      `);
      return { table, rows };
    } catch (error) {
      const message = String(error?.message || error);
      if (/does not exist|relation .* does not exist/i.test(message)) {
        continue;
      }
      throw error;
    }
  }
  return { table: null, rows: [] };
}

async function main() {
  // Load QM env first and capture its key before Core .env can overwrite ENCRYPTION_KEY.
  loadEnv(qmEnvPath);
  const qmDatabaseUrl = process.env.QUESTION_MAKER_DATABASE_URL || process.env.DATABASE_URL;
  const qmEncryptionKey = process.env.QM_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;

  const qmDatabaseUrlSnapshot = qmDatabaseUrl;
  const savedEncryptionKey = process.env.ENCRYPTION_KEY;
  const savedDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.ENCRYPTION_KEY;
  delete process.env.DATABASE_URL;

  loadEnv(coreEnvPath);
  const coreDatabaseUrl = process.env.CORE_DATABASE_URL || process.env.DATABASE_URL;
  const coreEncryptionKey = process.env.CORE_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;

  // Restore QM DATABASE_URL for any downstream tooling that expects it.
  if (savedDatabaseUrl && !process.env.QUESTION_MAKER_DATABASE_URL) {
    process.env.DATABASE_URL = savedDatabaseUrl;
  }
  if (savedEncryptionKey && !process.env.QM_ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = savedEncryptionKey;
  }

  if (!qmDatabaseUrlSnapshot) {
    console.warn(
      "Skipping canvas→Core migration: QUESTION_MAKER_DATABASE_URL / QM DATABASE_URL not set.",
    );
    return;
  }

  const qm = createClient(qmDatabaseUrlSnapshot);

  const summary = {
    sourceTable: null,
    qmRows: 0,
    migrated: 0,
    skippedCoreExists: 0,
    skippedNoCoreUser: 0,
    errors: 0,
  };

  let core;
  try {
    const { table, rows: qmRows } = await readQmIntegrations(qm);
    summary.sourceTable = table;
    summary.qmRows = qmRows.length;

    if (!table) {
      console.log("No QM canvas_integrations table (or backup) present — nothing to migrate.");
      return;
    }

    console.log(
      dryRun
        ? `[dry-run] Found ${summary.qmRows} row(s) in ${table}.`
        : `Found ${summary.qmRows} row(s) in ${table}.`,
    );

    if (summary.qmRows === 0) {
      console.log("QM canvas table is empty — nothing to migrate.");
      return;
    }

    // Fail closed: never let prisma migrate deploy rename away credential rows
    // without Core connectivity / keys (production Docker must set these).
    if (!coreDatabaseUrl) {
      console.error(
        `Refusing to skip canvas→Core migration: found ${summary.qmRows} QM row(s) but CORE_DATABASE_URL / Core DATABASE_URL is not set.`,
      );
      process.exit(1);
    }
    requireValue(qmEncryptionKey, "QM_ENCRYPTION_KEY (or ENCRYPTION_KEY in QM .env)");
    requireValue(coreEncryptionKey, "CORE_ENCRYPTION_KEY (or ENCRYPTION_KEY in Core .env)");

    core = createClient(coreDatabaseUrl);

    for (const row of qmRows) {
      const userId = row.user_id;

      const existing = await core.$queryRaw`
        SELECT "userId" FROM canvas_integrations WHERE "userId" = ${userId} LIMIT 1
      `;

      if (existing.length > 0) {
        summary.skippedCoreExists += 1;
        console.log(`skip (Core wins): userId=${userId}`);
        continue;
      }

      const coreUser = await core.$queryRaw`
        SELECT id FROM "user" WHERE id = ${userId} LIMIT 1
      `;

      if (coreUser.length === 0) {
        summary.skippedNoCoreUser += 1;
        console.warn(`skip (no Core user): userId=${userId}`);
        continue;
      }

      let coreApiKey;
      try {
        coreApiKey = reencryptCanvasApiKey(qmEncryptionKey, coreEncryptionKey, row.api_key);
      } catch (error) {
        summary.errors += 1;
        console.error(`error (re-encrypt): userId=${userId} — ${error.message}`);
        continue;
      }

      const id = createId();
      const action = dryRun ? "would migrate" : "migrated";
      console.log(
        `${action}: userId=${userId} canvasUrl=${row.canvas_url} isTestMode=${row.is_test_mode}`,
      );

      if (!dryRun) {
        try {
          await core.$executeRaw`
            INSERT INTO canvas_integrations (
              id, "userId", "canvasUrl", "apiKey", "isTestMode", "createdAt", "updatedAt"
            ) VALUES (
              ${id},
              ${userId},
              ${row.canvas_url},
              ${coreApiKey},
              ${row.is_test_mode},
              ${row.created_at},
              ${row.updated_at}
            )
          `;
          summary.migrated += 1;
        } catch (error) {
          summary.errors += 1;
          console.error(`error: userId=${userId} — ${error.message}`);
        }
      } else {
        summary.migrated += 1;
      }
    }
  } finally {
    await Promise.allSettled([qm.$disconnect(), core?.$disconnect?.()]);
  }

  console.log("");
  console.log("Summary");
  console.log(`  Source table:              ${summary.sourceTable ?? "(none)"}`);
  console.log(`  QM rows read:              ${summary.qmRows}`);
  console.log(`  ${dryRun ? "Would migrate" : "Migrated"}:               ${summary.migrated}`);
  console.log(`  Skipped (Core exists):     ${summary.skippedCoreExists}`);
  console.log(`  Skipped (no Core user):    ${summary.skippedNoCoreUser}`);
  console.log(`  Errors:                    ${summary.errors}`);

  // Unmigrated rows (no matching Core user) leave credentials stranded — fail closed.
  if (summary.errors > 0 || summary.skippedNoCoreUser > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
