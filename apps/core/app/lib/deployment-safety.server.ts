/**
 * Explicit deployment contract for local-only fixtures.
 *
 * An absent or unknown mode is intentionally unsafe for demos/seeding.  Local
 * fixtures require all contract values below, including a loopback-only auth URL;
 * shared and production deployments can never opt in by accident (or by
 * inheriting NODE_ENV alone).
 */

export type DeploymentEnvironment = {
  NODE_ENV?: string;
  EDUAI_DEPLOYMENT_MODE?: string;
  EDUAI_ENABLE_LOCAL_DEMO?: string;
  BETTER_AUTH_URL?: string;
  EDUAI_LOCAL_SEED_PASSWORD?: string;
};

function normalized(value: string | undefined): string | undefined {
  const result = value?.trim().toLowerCase();
  return result || undefined;
}

function isLoopbackAuthUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // Userinfo is never needed for Better Auth's base URL and can hide a public
  // authority behind a loopback-looking suffix (or vice versa).
  if (url.username || url.password) return false;

  // WHATWG URL retains brackets for IPv6 hostnames; compare the canonical
  // address without brackets and reject localhost subdomains/trailing dots.
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isLocalDemoEnabled(environment: DeploymentEnvironment = process.env): boolean {
  return (
    normalized(environment.NODE_ENV) === "development" &&
    normalized(environment.EDUAI_DEPLOYMENT_MODE) === "local" &&
    normalized(environment.EDUAI_ENABLE_LOCAL_DEMO) === "true" &&
    isLoopbackAuthUrl(environment.BETTER_AUTH_URL)
  );
}

/** Return the explicit local fixture password; never provide a known default. */
export function getLocalSeedPassword(environment: DeploymentEnvironment = process.env): string {
  assertLocalDemoEnvironment(environment);
  const password = environment.EDUAI_LOCAL_SEED_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "Refusing local demo fixtures: EDUAI_LOCAL_SEED_PASSWORD must be set to a local-only password",
    );
  }
  return password;
}

/** Throw before any fixed demo credentials or seed rows can be provisioned. */
export function assertLocalDemoEnvironment(environment: DeploymentEnvironment = process.env): void {
  if (!isLocalDemoEnabled(environment)) {
    throw new Error(
      "Refusing local demo fixtures: set NODE_ENV=development, EDUAI_DEPLOYMENT_MODE=local, EDUAI_ENABLE_LOCAL_DEMO=true, and BETTER_AUTH_URL to a loopback http(s) URL",
    );
  }
}
