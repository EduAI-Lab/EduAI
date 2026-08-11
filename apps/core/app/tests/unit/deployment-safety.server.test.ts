// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  assertLocalDemoEnvironment,
  isLocalDemoEnabled,
  type DeploymentEnvironment,
} from "~/lib/deployment-safety.server";

function env(overrides: Partial<DeploymentEnvironment> = {}): DeploymentEnvironment {
  return {
    NODE_ENV: "development",
    EDUAI_DEPLOYMENT_MODE: "local",
    EDUAI_ENABLE_LOCAL_DEMO: "true",
    ...overrides,
  };
}

describe("deployment safety contract", () => {
  it("enables local demo behavior only with every explicit local gate", () => {
    expect(isLocalDemoEnabled(env())).toBe(true);
    expect(isLocalDemoEnabled(env({ EDUAI_DEPLOYMENT_MODE: undefined }))).toBe(false);
    expect(isLocalDemoEnabled(env({ EDUAI_ENABLE_LOCAL_DEMO: undefined }))).toBe(false);
    expect(isLocalDemoEnabled(env({ NODE_ENV: "production" }))).toBe(false);
    expect(isLocalDemoEnabled(env({ EDUAI_DEPLOYMENT_MODE: "shared" }))).toBe(false);
  });

  it("fails closed when seed/deployment mode is ambiguous or shared", () => {
    expect(() => assertLocalDemoEnvironment(env({ EDUAI_DEPLOYMENT_MODE: undefined }))).toThrow(
      /refusing/i,
    );
    expect(() => assertLocalDemoEnvironment(env({ EDUAI_DEPLOYMENT_MODE: "shared" }))).toThrow(
      /refusing/i,
    );
    expect(() => assertLocalDemoEnvironment(env({ NODE_ENV: "production" }))).toThrow(/refusing/i);
    expect(() => assertLocalDemoEnvironment(env())).not.toThrow();
  });
});
