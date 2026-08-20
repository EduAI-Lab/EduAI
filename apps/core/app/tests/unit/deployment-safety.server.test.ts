// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  assertLocalDemoEnvironment,
  getLocalSeedPassword,
  isLocalDemoEnabled,
  type DeploymentEnvironment,
} from "~/lib/deployment-safety.server";

function env(overrides: Partial<DeploymentEnvironment> = {}): DeploymentEnvironment {
  return {
    NODE_ENV: "development",
    EDUAI_DEPLOYMENT_MODE: "local",
    EDUAI_ENABLE_LOCAL_DEMO: "true",
    BETTER_AUTH_URL: "http://localhost:3000",
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
    expect(isLocalDemoEnabled(env({ BETTER_AUTH_URL: "https://eduai.ok.ubc.ca" }))).toBe(false);
    expect(isLocalDemoEnabled(env({ BETTER_AUTH_URL: "http://localhost.evil.example" }))).toBe(
      false,
    );
    expect(isLocalDemoEnabled(env({ BETTER_AUTH_URL: "http://attacker@localhost:3000" }))).toBe(
      false,
    );
    expect(isLocalDemoEnabled(env({ BETTER_AUTH_URL: "ftp://localhost:3000" }))).toBe(false);
    expect(isLocalDemoEnabled(env({ BETTER_AUTH_URL: undefined }))).toBe(false);
    expect(isLocalDemoEnabled(env({ BETTER_AUTH_URL: "https://127.0.0.1:3443" }))).toBe(true);
    expect(isLocalDemoEnabled(env({ BETTER_AUTH_URL: "http://[::1]:3000" }))).toBe(true);
  });

  it("fails closed when seed/deployment mode is ambiguous or shared", () => {
    expect(() => assertLocalDemoEnvironment(env({ EDUAI_DEPLOYMENT_MODE: undefined }))).toThrow(
      /refusing/i,
    );
    expect(() => assertLocalDemoEnvironment(env({ EDUAI_DEPLOYMENT_MODE: "shared" }))).toThrow(
      /refusing/i,
    );
    expect(() => assertLocalDemoEnvironment(env({ NODE_ENV: "production" }))).toThrow(/refusing/i);
    expect(() =>
      assertLocalDemoEnvironment(env({ BETTER_AUTH_URL: "https://eduai.ok.ubc.ca" })),
    ).toThrow(/refusing/i);
    expect(() => assertLocalDemoEnvironment(env())).not.toThrow();
  });

  it("requires a caller-supplied local seed password and never falls back to a known credential", () => {
    expect(
      getLocalSeedPassword(env({ EDUAI_LOCAL_SEED_PASSWORD: "local-only-random-password" })),
    ).toBe("local-only-random-password");
    expect(() => getLocalSeedPassword(env())).toThrow(/EDUAI_LOCAL_SEED_PASSWORD/i);
    expect(() =>
      getLocalSeedPassword(
        env({
          EDUAI_LOCAL_SEED_PASSWORD: "local-only-random-password",
          BETTER_AUTH_URL: "https://eduai.ok.ubc.ca",
        }),
      ),
    ).toThrow(/refusing/i);
  });
});
