// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  classifyProviderError,
  providerErrorDiagnostic,
  PUBLIC_PROVIDER_TOOL_ARGUMENT_ERROR,
} from "~/lib/ai/provider-errors.server";
import { REDACTED_VALUE } from "~/lib/redact.server";

describe("provider error boundaries", () => {
  it("keeps tool-argument validation useful without exposing provider arguments", () => {
    const error = new Error(
      'Invalid arguments for tool fetchPage: {"apiKey":"provider-tool-secret"}',
    );
    error.name = "AI_InvalidToolArgumentsError";

    expect(classifyProviderError(error, "stream")).toEqual({
      message: PUBLIC_PROVIDER_TOOL_ARGUMENT_ERROR,
      code: "LLM_TOOL_ARGUMENTS_INVALID",
      status: 400,
    });
  });

  it("uses stable public setup and stream failures", () => {
    expect(classifyProviderError(new Error("private setup detail"), "setup")).toEqual({
      message: "LLM provider setup failed",
      code: "LLM_PROVIDER_SETUP_FAILED",
      status: 502,
    });
    expect(classifyProviderError(new Error("private stream detail"), "stream")).toEqual({
      message: "LLM stream failed",
      code: "LLM_STREAM_FAILED",
      status: 502,
    });
  });

  it("redacts and bounds structured diagnostics", () => {
    const error = new Error(
      `upstream https://provider.test/v1?api_key=provider-log-secret ${"x".repeat(4_000)}`,
    );
    error.name = "AI_APICallError";

    const diagnostic = providerErrorDiagnostic(error);

    expect(diagnostic.name).toBe("AI_APICallError");
    expect(diagnostic.message).toContain(REDACTED_VALUE);
    expect(diagnostic.message).not.toContain("provider-log-secret");
    expect(diagnostic.message.length).toBeLessThanOrEqual(2_049);
    expect(JSON.stringify(diagnostic)).not.toContain("provider-log-secret");
  });
});
