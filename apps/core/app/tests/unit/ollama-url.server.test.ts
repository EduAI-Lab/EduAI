// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidOllamaBaseUrlError,
  ollamaTagsUrl,
  resolveAllowedOllamaBaseUrl,
} from "~/lib/ai/ollama-url.server";

const originalBaseUrl = process.env.OLLAMA_BASE_URL;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalBaseUrl;
});

describe("resolveAllowedOllamaBaseUrl", () => {
  it("allows loopback and the configured hostname", () => {
    process.env.OLLAMA_BASE_URL = "https://ollama.example.edu:11434/api";

    expect(resolveAllowedOllamaBaseUrl("http://127.0.0.1:11434/api")).toBe(
      "http://127.0.0.1:11434/api",
    );
    expect(ollamaTagsUrl("https://ollama.example.edu:9443/api")).toBe(
      "https://ollama.example.edu:9443/api/tags",
    );
  });

  it("rejects non-HTTP schemes and arbitrary metadata hosts", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/api";

    expect(() => resolveAllowedOllamaBaseUrl("file:///etc/passwd")).toThrow(
      InvalidOllamaBaseUrlError,
    );
    expect(() => resolveAllowedOllamaBaseUrl("http://169.254.169.254/latest/meta-data")).toThrow(
      InvalidOllamaBaseUrlError,
    );
  });
});
