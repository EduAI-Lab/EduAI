// @vitest-environment node
/**
 * Upgrade regression (#828 / PR #849): entity idempotency keys must be copied
 * into idempotency_records before the columns are dropped, and actor scoping
 * must preserve those rows.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_ENTITY_BACKFILL_HASH } from "~/lib/idempotency.server";

const migrationsDir = join(process.cwd(), "prisma/migrations");

describe("idempotency entity-key upgrade SQL", () => {
  it("backfills question keys before dropping the column", () => {
    const sql = readFileSync(
      join(migrationsDir, "20260702120000_drop_entity_idempotency_keys/migration.sql"),
      "utf8",
    );
    expect(sql).toContain(`'${LEGACY_ENTITY_BACKFILL_HASH}'`);
    expect(sql).toMatch(/INSERT INTO "idempotency_records"/);
    expect(sql).toMatch(/FROM "questions"/);
    expect(sql).toMatch(/q\."idempotencyKey"/);
    const insertAt = sql.indexOf('INSERT INTO "idempotency_records"');
    const dropAt = sql.indexOf('ALTER TABLE "questions" DROP COLUMN');
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(dropAt).toBeGreaterThan(insertAt);
  });

  it("scopes actorId from backfill without wiping legacy rows", () => {
    const sql = readFileSync(
      join(migrationsDir, "20260714120000_scope_idempotency_to_actor/migration.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/DELETE FROM "idempotency_records"\s*;/);
    expect(sql).toMatch(/responseBody"->>'createdBy'/);
    expect(sql).toMatch(/legacy-entity-backfill/);
  });
});
