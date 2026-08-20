// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260811120000_better_auth_api_key_contract/migration.sql",
  ),
  "utf8",
);

describe("Better Auth API-key contract migration", () => {
  it("hardens old unrestricted rows instead of only changing insert defaults", () => {
    const hardening = migrationSql.match(/UPDATE "apiKey"\s+SET[\s\S]*?WHERE[\s\S]*?;/)?.[0];

    expect(hardening).toBeDefined();
    expect(hardening).toContain('"rateLimitEnabled" = true');
    expect(hardening).toContain('"rateLimitTimeWindow" = COALESCE');
    expect(hardening).toContain('"rateLimitMax" = COALESCE');
    expect(hardening).toContain('"expiresAt" = LEAST');
    expect(hardening).toContain("\"createdAt\" + INTERVAL '365 days'");

    // The migration must not rewrite the credential or its ownership/metadata
    // while it adds the bounded policy to legacy rows.
    expect(hardening).not.toMatch(/"key"\s*=/);
    expect(hardening).not.toMatch(/"referenceId"\s*=/);
    expect(hardening).not.toMatch(/"metadata"\s*=/);
    expect(hardening).not.toMatch(/"permissions"\s*=/);
  });

  it("hardens rows before installing Better Auth defaults", () => {
    const hardeningAt = migrationSql.indexOf('UPDATE "apiKey"');
    const defaultsAt = migrationSql.indexOf('ALTER COLUMN "rateLimitEnabled" SET DEFAULT true');

    expect(hardeningAt).toBeGreaterThanOrEqual(0);
    expect(defaultsAt).toBeGreaterThan(hardeningAt);
  });
});
