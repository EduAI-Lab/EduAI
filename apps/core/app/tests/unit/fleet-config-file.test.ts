import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FleetConfigError, loadFleetConfigFile } from "~/lib/ai/routing/fleet/config-file";

describe("loadFleetConfigFile", () => {
  let tmpDir: string;
  const originalConfigPath = process.env.FLEET_CONFIG_PATH;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fleet-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
    else process.env.FLEET_CONFIG_PATH = originalConfigPath;
  });

  function writeConfig(contents: string): string {
    const path = join(tmpDir, "fleet.config.json");
    writeFileSync(path, contents, "utf-8");
    process.env.FLEET_CONFIG_PATH = path;
    return path;
  }

  it("returns null when the file does not exist", () => {
    process.env.FLEET_CONFIG_PATH = join(tmpDir, "does-not-exist.json");
    expect(loadFleetConfigFile()).toBeNull();
  });

  it("parses a valid config with per-server job types and optional models", () => {
    writeConfig(
      JSON.stringify({
        servers: [
          {
            id: "cmps01",
            baseUrl: "http://cmps01.ok.ubc.ca:8001",
            jobTypes: ["interactive"],
            models: ["qwen3.5-2b-instruct"],
          },
          {
            id: "cmps03",
            baseUrl: "http://cmps03.ok.ubc.ca:8001",
            jobTypes: ["background"],
          },
        ],
      }),
    );

    const config = loadFleetConfigFile();
    expect(config).toEqual({
      servers: [
        {
          id: "cmps01",
          baseUrl: "http://cmps01.ok.ubc.ca:8001",
          jobTypes: ["interactive"],
          models: ["qwen3.5-2b-instruct"],
        },
        {
          id: "cmps03",
          baseUrl: "http://cmps03.ok.ubc.ca:8001",
          jobTypes: ["background"],
          models: [],
        },
      ],
    });
  });

  it("strips a trailing slash from baseUrl", () => {
    writeConfig(
      JSON.stringify({
        servers: [
          { id: "cmps01", baseUrl: "http://cmps01.ok.ubc.ca:8001/", jobTypes: ["interactive"] },
        ],
      }),
    );

    expect(loadFleetConfigFile()?.servers[0]?.baseUrl).toBe("http://cmps01.ok.ubc.ca:8001");
  });

  it("throws FleetConfigError for invalid JSON", () => {
    writeConfig("{ not valid json");
    expect(() => loadFleetConfigFile()).toThrow(FleetConfigError);
  });

  it("throws FleetConfigError when servers is missing", () => {
    writeConfig(JSON.stringify({ notServers: [] }));
    expect(() => loadFleetConfigFile()).toThrow(FleetConfigError);
  });

  it("throws FleetConfigError when a server is missing a required field", () => {
    writeConfig(JSON.stringify({ servers: [{ id: "cmps01" }] }));
    expect(() => loadFleetConfigFile()).toThrow(/baseUrl/);
  });

  it("throws FleetConfigError for an invalid baseUrl", () => {
    writeConfig(
      JSON.stringify({
        servers: [{ id: "cmps01", baseUrl: "not-a-url", jobTypes: ["interactive"] }],
      }),
    );
    expect(() => loadFleetConfigFile()).toThrow(/not a valid URL/);
  });

  it("throws FleetConfigError for an invalid jobTypes entry", () => {
    writeConfig(
      JSON.stringify({
        servers: [
          { id: "cmps01", baseUrl: "http://cmps01.ok.ubc.ca:8001", jobTypes: ["heavy"] },
        ],
      }),
    );
    expect(() => loadFleetConfigFile()).toThrow(/jobTypes/);
  });

  it("throws FleetConfigError on duplicate server ids", () => {
    writeConfig(
      JSON.stringify({
        servers: [
          { id: "cmps01", baseUrl: "http://cmps01.ok.ubc.ca:8001", jobTypes: ["interactive"] },
          { id: "cmps01", baseUrl: "http://cmps01-b.ok.ubc.ca:8001", jobTypes: ["interactive"] },
        ],
      }),
    );
    expect(() => loadFleetConfigFile()).toThrow(/duplicate server id/);
  });
});
