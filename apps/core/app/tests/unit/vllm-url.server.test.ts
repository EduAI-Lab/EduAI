// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { InvalidVllmBaseUrlError, resolveAllowedVllmBaseUrl } from "~/lib/ai/vllm-url.server";

const originalVllmBaseUrl = process.env.VLLM_BASE_URL;
const originalFleetChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
const originalFleetHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;

afterEach(() => {
  if (originalVllmBaseUrl === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllmBaseUrl;
  if (originalFleetChatUrls === undefined) delete process.env.VLLM_FLEET_CHAT_URLS;
  else process.env.VLLM_FLEET_CHAT_URLS = originalFleetChatUrls;
  if (originalFleetHeavyUrl === undefined) delete process.env.VLLM_FLEET_HEAVY_URL;
  else process.env.VLLM_FLEET_HEAVY_URL = originalFleetHeavyUrl;
});

describe("resolveAllowedVllmBaseUrl", () => {
  it("allows loopback and the configured hostname", () => {
    process.env.VLLM_BASE_URL = "http://vllm.example.edu:8001";

    expect(resolveAllowedVllmBaseUrl("http://127.0.0.1:8001")).toBe("http://127.0.0.1:8001");
    expect(resolveAllowedVllmBaseUrl("http://vllm.example.edu:9443")).toBe(
      "http://vllm.example.edu:9443",
    );
  });

  it("allows configured fleet hostnames", () => {
    process.env.VLLM_BASE_URL = "http://vllm.example.edu:8001";
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
    process.env.VLLM_FLEET_HEAVY_URL = "http://cmps03.ok.ubc.ca:8001";

    expect(resolveAllowedVllmBaseUrl("http://cmps02.ok.ubc.ca:8001")).toBe(
      "http://cmps02.ok.ubc.ca:8001",
    );
    expect(resolveAllowedVllmBaseUrl("http://cmps03.ok.ubc.ca:8001")).toBe(
      "http://cmps03.ok.ubc.ca:8001",
    );
  });

  it("rejects arbitrary hosts and cloud metadata endpoints", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";

    expect(() => resolveAllowedVllmBaseUrl("http://169.254.169.254/latest/meta-data")).toThrow(
      InvalidVllmBaseUrlError,
    );
    expect(() => resolveAllowedVllmBaseUrl("http://attacker.example.com")).toThrow(
      InvalidVllmBaseUrlError,
    );
  });

  it("rejects non-HTTP schemes", () => {
    expect(() => resolveAllowedVllmBaseUrl("file:///etc/passwd")).toThrow(
      InvalidVllmBaseUrlError,
    );
  });
});
