import { afterEach, describe, expect, it } from "vitest";
import {
  cmps01InternalAuthHeaders,
  cmps01InternalAuthHeadersForUrl,
  isTrustedCmps01EdgeUrl,
} from "~/lib/ai/cmps01-internal-auth.server";

describe("cmps01 internal auth", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("trusts server OLLAMA_BASE_URL edge path", () => {
    process.env = {
      ...env,
      OLLAMA_BASE_URL: "http://cmps01.ok.ubc.ca:8001/ollama",
    };
    expect(isTrustedCmps01EdgeUrl("http://cmps01.ok.ubc.ca:8001/ollama/api")).toBe(
      true,
    );
    expect(isTrustedCmps01EdgeUrl("http://evil.example/ollama/api")).toBe(false);
  });

  it("does not send internal key to untrusted Ollama URLs", () => {
    process.env = { ...env, CMPS01_INTERNAL_KEY: "secret", OLLAMA_BASE_URL: undefined };
    expect(cmps01InternalAuthHeadersForUrl("http://attacker.example/api")).toEqual(
      {},
    );
  });

  it("sends internal key only for trusted edge URLs", () => {
    process.env = {
      ...env,
      CMPS01_INTERNAL_KEY: "secret",
      OLLAMA_BASE_URL: "http://cmps01.ok.ubc.ca:8001/ollama",
    };
    expect(cmps01InternalAuthHeadersForUrl("http://cmps01.ok.ubc.ca:8001/ollama/api")).toEqual(
      cmps01InternalAuthHeaders(),
    );
  });

  it("does not trust VLLM_BASE_URL host for Ollama edge auth", () => {
    process.env = {
      ...env,
      CMPS01_INTERNAL_KEY: "secret",
      OLLAMA_BASE_URL: undefined,
      VLLM_BASE_URL: "http://cmps01.ok.ubc.ca:8001",
    };
    expect(isTrustedCmps01EdgeUrl("http://cmps01.ok.ubc.ca:8001/ollama/api")).toBe(
      false,
    );
  });

  it("trusts the explicitly configured CMPS embedding edge", () => {
    process.env = {
      ...env,
      CMPS01_INTERNAL_KEY: "secret",
      VLLM_EMBEDDING_BASE_URL: "http://cmps01.ok.ubc.ca:8001/v1",
    };
    expect(isTrustedCmps01EdgeUrl("http://cmps01.ok.ubc.ca:8001/v1")).toBe(true);
    expect(
      cmps01InternalAuthHeadersForUrl("http://cmps01.ok.ubc.ca:8001/v1"),
    ).toEqual(cmps01InternalAuthHeaders());
  });

  it("does not treat the research energy URL as an application auth target", () => {
    process.env = {
      ...env,
      OLLAMA_BASE_URL: undefined,
      ENERGY_SIDECAR_URL: "http://cmps01.ok.ubc.ca:8001/energy",
    };
    expect(isTrustedCmps01EdgeUrl("http://cmps01.ok.ubc.ca:8001/energy")).toBe(
      false,
    );
  });
});
