/**
 * Explicit deployment contract for local-only fixtures.
 *
 * An absent or unknown mode is intentionally unsafe for demos/seeding.  Local
 * fixtures require all three values below; shared and production deployments
 * can never opt in by accident (or by inheriting NODE_ENV alone).
 */

export type DeploymentEnvironment = {
  NODE_ENV?: string;
  EDUAI_DEPLOYMENT_MODE?: string;
  EDUAI_ENABLE_LOCAL_DEMO?: string;
};

function normalized(value: string | undefined): string | undefined {
  const result = value?.trim().toLowerCase();
  return result || undefined;
}
export function isLocalDemoEnabled(
  environment: DeploymentEnvironment = process.env,
): boolean {
  return (
    normalized(environment.NODE_ENV) === "development" &&
    normalized(environment.EDUAI_DEPLOYMENT_MODE) === "local" &&
    normalized(environment.EDUAI_ENABLE_LOCAL_DEMO) === "true"
  );
}

/** Throw before any fixed demo credentials or seed rows can be provisioned. */
export function assertLocalDemoEnvironment(
  environment: DeploymentEnvironment = process.env,
): void {
  if (!isLocalDemoEnabled(environment)) {
    throw new Error(
      "Refusing local demo fixtures: set NODE_ENV=development, EDUAI_DEPLOYMENT_MODE=local, and EDUAI_ENABLE_LOCAL_DEMO=true",
    );
  }
}
