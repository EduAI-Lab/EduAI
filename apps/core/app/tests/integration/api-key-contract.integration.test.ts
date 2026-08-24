import type { JsonObject } from "~/lib/json-value";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";

function cookieHeaderFrom(response: Response): string {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  return setCookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

describe("Better Auth API-key Prisma contract", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates, lists, and revokes API keys for an authenticated admin", async () => {
    const email = `api-key-contract-${randomUUID()}@ubc.ca`;
    const signUp = (await auth.api.signUpEmail({
      body: { email, name: "API-key contract admin", password: "Str0ng!Contract-Password" },
      asResponse: true,
    })) as Response;
    expect(signUp.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    const cookie = cookieHeaderFrom(signUp);

    const create = await auth.handler(
      new Request("http://localhost/api/auth/api-key/create", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "contract-test", expiresIn: 86_400 }),
      }),
    );
    expect(create.status).toBe(200);
    const created = (await create.json()) as {
      id: string;
      key: string;
      referenceId: string;
      configId: string;
    };
    expect(created).toMatchObject({ referenceId: user.id, configId: "default" });
    expect(created.key).toEqual(expect.any(String));

    const list = await auth.handler(
      new Request("http://localhost/api/auth/api-key/list", {
        headers: { cookie },
      }),
    );

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      apiKeys: [{ id: created.id, referenceId: user.id }],
      total: 1,
    });

    const revoke = await auth.handler(
      new Request("http://localhost/api/auth/api-key/delete", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ keyId: created.id }),
      }),
    );
    expect(revoke.status).toBe(200);
    await expect(revoke.json()).resolves.toEqual({ success: true });

    const listAfterRevoke = await auth.handler(
      new Request("http://localhost/api/auth/api-key/list", { headers: { cookie } }),
    );
    expect(listAfterRevoke.status).toBe(200);
    await expect(listAfterRevoke.json()).resolves.toMatchObject({ apiKeys: [], total: 0 });

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("hardens an old-60 unrestricted key before Better Auth verifies or lists it", async () => {
    const email = `api-key-legacy-${randomUUID()}@ubc.ca`;
    const signUp = (await auth.api.signUpEmail({
      body: { email, name: "Legacy API-key admin", password: "Str0ng!Legacy-Password" },
      asResponse: true,
    })) as Response;
    expect(signUp.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    const cookie = cookieHeaderFrom(signUp);

    try {
      const create = await auth.handler(
        new Request("http://localhost/api/auth/api-key/create", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "legacy-contract-test", expiresIn: 86_400 }),
        }),
      );
      expect(create.status).toBe(200);
      const created = (await create.json()) as {
        id: string;
        key: string;
      };
      expect(created.key).toEqual(expect.any(String));

      const before = await prisma.$queryRaw<
        Array<{
          key: string;
          referenceId: string;
          metadata: string | null;
          permissions: string | null;
        }>
      >`
        SELECT "key", "referenceId", "metadata", "permissions"
        FROM "apiKey"
        WHERE "id" = ${created.id}
      `;
      expect(before).toHaveLength(1);
      const storedHash = before[0].key;
      const metadata = JSON.stringify({ migrated: true, source: "old-60" });
      const permissions = JSON.stringify({ apiKey: ["read"] });

      // This is the row shape produced by migration 60: enabled but perpetual
      // and unmetered. Verify it first to make the pre-fix bypass observable.
      await prisma.$executeRaw`
        UPDATE "apiKey"
        SET "rateLimitEnabled" = false,
            "rateLimitTimeWindow" = NULL,
            "rateLimitMax" = NULL,
            "requestCount" = 0,
            "lastRequest" = NULL,
            "expiresAt" = NULL,
            "metadata" = ${metadata},
            "permissions" = ${permissions}
        WHERE "id" = ${created.id}
      `;
      const legacyAttempts = [];
      for (let index = 0; index < 11; index += 1) {
        legacyAttempts.push(await auth.api.verifyApiKey({ body: { key: created.key } }));
      }
      expect(legacyAttempts.every((attempt) => attempt.valid)).toBe(true);

      // Execute the data statement from migration 61 itself. Running the full
      // migration here would rename an already-upgraded test table; extracting
      // this statement keeps the test on a real PostgreSQL row while proving
      // that the checked-in migration, rather than a duplicate test policy,
      // supplies the hardening behavior.
      const migrationSql = readFileSync(
        join(
          process.cwd(),
          "prisma/migrations/20260811120000_better_auth_api_key_contract/migration.sql",
        ),
        "utf8",
      );
      const hardening = migrationSql.match(/UPDATE "apiKey"\s+SET[\s\S]*?WHERE[\s\S]*?;/)?.[0];
      expect(hardening).toBeDefined();
      await prisma.$executeRawUnsafe(hardening!);

      const after = await prisma.$queryRaw<
        Array<{
          key: string;
          referenceId: string;
          metadata: string | null;
          permissions: string | null;
          rateLimitEnabled: boolean;
          rateLimitTimeWindow: number | null;
          rateLimitMax: number | null;
          expiresAt: Date | null;
        }>
      >`
        SELECT "key", "referenceId", "metadata", "permissions",
               "rateLimitEnabled", "rateLimitTimeWindow", "rateLimitMax", "expiresAt"
        FROM "apiKey"
        WHERE "id" = ${created.id}
      `;
      expect(after[0]).toMatchObject({
        key: storedHash,
        referenceId: user.id,
        metadata,
        permissions,
        rateLimitEnabled: true,
        rateLimitTimeWindow: 86_400_000,
        rateLimitMax: 10,
      });
      expect(after[0].expiresAt).toBeInstanceOf(Date);
      expect(after[0].expiresAt!.getTime()).toBeGreaterThan(Date.now());

      const list = await auth.handler(
        new Request("http://localhost/api/auth/api-key/list", { headers: { cookie } }),
      );
      expect(list.status).toBe(200);
      const listed = (await list.json()) as {
        apiKeys: JsonObject[];
        total: number;
      };
      expect(listed.total).toBe(1);
      expect(listed.apiKeys[0]).toMatchObject({
        id: created.id,
        referenceId: user.id,
        rateLimitEnabled: true,
        rateLimitTimeWindow: 86_400_000,
        rateLimitMax: 10,
        expiresAt: expect.any(String),
      });

      // Better Auth's real verifier now consumes the bounded 10-request window
      // instead of treating the old key as unlimited.
      await prisma.$executeRaw`
        UPDATE "apiKey"
        SET "requestCount" = 0, "lastRequest" = NULL
        WHERE "id" = ${created.id}
      `;
      const migratedAttempts = [];
      for (let index = 0; index < 11; index += 1) {
        migratedAttempts.push(await auth.api.verifyApiKey({ body: { key: created.key } }));
      }
      expect(migratedAttempts.slice(0, 10).every((attempt) => attempt.valid)).toBe(true);
      expect(migratedAttempts[10]).toMatchObject({
        valid: false,
        error: { code: "RATE_LIMITED" },
        key: null,
      });
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
