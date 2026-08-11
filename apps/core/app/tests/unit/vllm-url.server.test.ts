// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { InvalidVllmBaseUrlError, resolveAllowedVllmBaseUrl } from "~/lib/ai/vllm-url.server";

const originalVllmBaseUrl = process.env.VLLM_BASE_URL;
const originalFleetChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
const originalFleetHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalVllmBaseUrl === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllmBaseUrl;
  if (originalFleetChatUrls === undefined) delete process.env.VLLM_FLEET_CHAT_URLS;
  else process.env.VLLM_FLEET_CHAT_URLS = originalFleetChatUrls;
  if (originalFleetHeavyUrl === undefined) delete process.env.VLLM_FLEET_HEAVY_URL;
  else process.env.VLLM_FLEET_HEAVY_URL = originalFleetHeavyUrl;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("resolveAllowedVllmBaseUrl", () => {
  it("allows loopback and the configured hostname", () => {
    process.env.VLLM_BASE_URL = "http://vllm.example.edu:8001";

    expect(resolveAllowedVllmBaseUrl("http://127.0.0.1:8001")).toBe("http://127.0.0.1:8001");
    expect(resolveAllowedVllmBaseUrl("http://vllm.example.edu:8001")).toBe(
      "http://vllm.example.edu:8001",
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

  it("allows an independently configured embedding host", () => {
    process.env.CMPS01_INTERNAL_BASE_URL = "http://cmps01.ok.ubc.ca:8001";

    expect(resolveAllowedVllmBaseUrl("http://cmps01.ok.ubc.ca:8001/v1")).toBe(
      "http://cmps01.ok.ubc.ca:8001/v1",
    );
  });

  it("does not trust the candidate embedding URL by itself", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    process.env.VLLM_EMBEDDING_BASE_URL = "http://attacker.example.com/v1";

    expect(() => resolveAllowedVllmBaseUrl(process.env.VLLM_EMBEDDING_BASE_URL)).toThrow(
      InvalidVllmBaseUrlError,
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
    expect(() => resolveAllowedVllmBaseUrl("file:///etc/passwd")).toThrow(InvalidVllmBaseUrlError);
  });

  it("rejects arbitrary loopback ports and paths in production", () => {
    process.env.NODE_ENV = "production";
    process.env.VLLM_BASE_URL = "http://vllm.example.edu:8001/v1";

    expect(() => resolveAllowedVllmBaseUrl("http://127.0.0.1:9999/private")).toThrow(
      InvalidVllmBaseUrlError,
    );
    expect(() => resolveAllowedVllmBaseUrl("http://127.0.0.1:8001/v1")).toThrow(
      InvalidVllmBaseUrlError,
    );
    expect(() => resolveAllowedVllmBaseUrl("http://vllm.example.edu:8001/private")).toThrow(
      InvalidVllmBaseUrlError,
    );
  });
});
