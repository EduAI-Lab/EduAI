import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Resolves the integration-test DATABASE_URL.
 *
 * Loads `.env.test` for test-only secrets and the `eduai_test` database name.
 * When `.env` exists (local dev), reuses its Postgres host/port/credentials so
 * Windows machines on a custom CORE_DB_PORT (e.g. 54400) do not need a second server.
 */
export function resolveIntegrationTestDatabaseUrl(): string {
  config({ path: resolve(appRoot, ".env") });
  const devDbUrl = process.env.DATABASE_URL;

  config({ path: resolve(appRoot, ".env.test"), override: true });
  const configuredTestUrl = process.env.DATABASE_URL;
  if (!configuredTestUrl) {
    throw new Error("DATABASE_URL is missing from apps/core/.env.test");
  }

  const testUrl = new URL(configuredTestUrl);
  const testDbName = testUrl.pathname.replace(/^\//, "").split("?")[0] || "eduai_test";

  if (devDbUrl) {
    const devUrl = new URL(devDbUrl);
    testUrl.username = devUrl.username;
    testUrl.password = devUrl.password;
    testUrl.hostname = devUrl.hostname;
    testUrl.port = devUrl.port;
  }

  testUrl.pathname = `/${testDbName}`;
  const resolved = testUrl.toString();
  process.env.DATABASE_URL = resolved;
  return resolved;
}
