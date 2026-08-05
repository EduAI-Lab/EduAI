// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatApiReject } from "~/lib/chat-api-log";
import { REDACTED_VALUE } from "~/lib/redact.server";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("chatApiReject", () => {
  it("redacts secrets in the logged trace without altering the response body", async () => {
    const body = { error: "upstream rejected the request" };
    const response = chatApiReject(502, body, {
      upstreamUrl: "https://provider.test/v1/chat?api_key=live-key-123",
      apiKey: "sk-live-abcdef",
    });

    const [, logged] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    const trace = logged.trace as Record<string, unknown>;
    expect(trace.apiKey).toBe(REDACTED_VALUE);
    expect(trace.upstreamUrl).toBe(`https://provider.test/v1/chat?api_key=${REDACTED_VALUE}`);
    expect(JSON.stringify(logged)).not.toContain("sk-live-abcdef");

    // Sanitizing must not mutate the caller's object or change what the client receives.
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream rejected the request" });
  });

  it("logs the status and a trace-less rejection without throwing", () => {
    chatApiReject(400, { error: "bad request" });

    const [, logged] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(logged.status).toBe(400);
    expect(logged.trace).toBeUndefined();
  });
});
