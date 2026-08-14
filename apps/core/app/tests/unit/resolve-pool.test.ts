// @vitest-environment node
// resolveQueueName() (#1351/#1418 review) — verifies the BullMQ pool
// selector agrees with the fleet registry's config-file-first, env-var-
// fallback resolution instead of checking VLLM_FLEET_HEAVY_URL directly.
// Previously a background server registered only via fleet.config.json (no
// heavy env var set) never routed to ai-jobs-heavy, silently diverging from
// what the fleet registry itself reports.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetFleetRegistryCache } from "~/lib/ai/routing/fleet/registry";
import {
  priorityFor,
  PRIORITY_BACKGROUND,
  PRIORITY_INTERACTIVE,
  QUEUE_CHAT,
  QUEUE_HEAVY,
  resolveQueueName,
} from "~/lib/queue/resolve-pool.server";

const NONEXISTENT_CONFIG_PATH = "./__no-such-fleet-config__.json";

describe("resolveQueueName — env var fallback (no config file)", () => {
  const originalConfigPath = process.env.FLEET_CONFIG_PATH;
  const originalHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;

  beforeEach(() => {
    process.env.FLEET_CONFIG_PATH = NONEXISTENT_CONFIG_PATH;
    delete process.env.VLLM_FLEET_HEAVY_URL;
    resetFleetRegistryCache();
  });

  afterEach(() => {
    if (originalConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
    else process.env.FLEET_CONFIG_PATH = originalConfigPath;
    if (originalHeavyUrl === undefined) delete process.env.VLLM_FLEET_HEAVY_URL;
    else process.env.VLLM_FLEET_HEAVY_URL = originalHeavyUrl;
    resetFleetRegistryCache();
  });

  it("interactive always resolves to the chat queue", () => {
    expect(resolveQueueName("interactive")).toBe(QUEUE_CHAT);
  });

  it("background shares the chat queue when no heavy pool is configured", () => {
    expect(resolveQueueName("background")).toBe(QUEUE_CHAT);
  });

  it("background resolves to the heavy queue once VLLM_FLEET_HEAVY_URL is set", () => {
    process.env.VLLM_FLEET_HEAVY_URL = "http://cmps03.ok.ubc.ca:8001";
    resetFleetRegistryCache();
    expect(resolveQueueName("background")).toBe(QUEUE_HEAVY);
  });
});

describe("resolveQueueName — fleet.config.json", () => {
  let tmpDir: string;
  const originalConfigPath = process.env.FLEET_CONFIG_PATH;
  const originalHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "resolve-pool-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
    else process.env.FLEET_CONFIG_PATH = originalConfigPath;
    if (originalHeavyUrl === undefined) delete process.env.VLLM_FLEET_HEAVY_URL;
    else process.env.VLLM_FLEET_HEAVY_URL = originalHeavyUrl;
    resetFleetRegistryCache();
  });

  function writeConfig(servers: unknown[]): void {
    const path = join(tmpDir, "fleet.config.json");
    writeFileSync(path, JSON.stringify({ servers }), "utf-8");
    process.env.FLEET_CONFIG_PATH = path;
  }

  it("routes background to the heavy queue for a background server declared only in the config file, with no heavy env var set", () => {
    delete process.env.VLLM_FLEET_HEAVY_URL;
    writeConfig([
      { id: "cmps01", baseUrl: "http://cmps01.ok.ubc.ca:8001", jobTypes: ["interactive"] },
      { id: "cmps03", baseUrl: "http://cmps03.ok.ubc.ca:8001", jobTypes: ["background"] },
    ]);
    resetFleetRegistryCache();

    expect(resolveQueueName("background")).toBe(QUEUE_HEAVY);
    expect(resolveQueueName("interactive")).toBe(QUEUE_CHAT);
  });

  it("shares the chat queue when the config file has no background-capable server, even with a stale heavy env var set", () => {
    // The config file is the single source of truth once present — a leftover
    // VLLM_FLEET_HEAVY_URL from an unmigrated .env must not leak through.
    process.env.VLLM_FLEET_HEAVY_URL = "http://stale-env-only:8001";
    writeConfig([
      { id: "cmps01", baseUrl: "http://cmps01.ok.ubc.ca:8001", jobTypes: ["interactive"] },
    ]);
    resetFleetRegistryCache();

    expect(resolveQueueName("background")).toBe(QUEUE_CHAT);
  });
});

describe("priorityFor", () => {
  it("gives interactive strictly higher priority (lower number) than background", () => {
    expect(priorityFor("interactive")).toBe(PRIORITY_INTERACTIVE);
    expect(priorityFor("background")).toBe(PRIORITY_BACKGROUND);
    expect(PRIORITY_INTERACTIVE).toBeLessThan(PRIORITY_BACKGROUND);
  });
});
