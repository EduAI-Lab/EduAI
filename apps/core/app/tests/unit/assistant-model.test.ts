// @vitest-environment node
/**
 * The help assistant's model call: each attempt gets its own timeout, only
 * failures a retry could fix are retried, and a provider that answered (e.g.
 * 503 "high demand") is never reported as unreachable just because the retry
 * then timed out.
 */
import { APICallError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import { callAssistantModel } from "~/lib/assistant/assistant-model.server";

const generate = vi.mocked(generateText);

function upstream(statusCode: number) {
  return new APICallError({
    message: `status ${statusCode}`,
    url: "https://provider.test",
    requestBodyValues: {},
    statusCode,
  });
}

const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

function call() {
  return callAssistantModel({
    provider: "google",
    model: "gemini-flash-latest",
    key: { tier: "SAVED", apiKey: "test-key" },
    messages: [{ role: "user", content: "q" }],
    maxTokens: 100,
  });
}

describe("callAssistantModel", () => {
  beforeEach(() => {
    generate.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("gives each attempt its own timeout and does not let the SDK retry", async () => {
    generate.mockResolvedValue({ text: " answer " } as Awaited<ReturnType<typeof generateText>>);
    expect(await call()).toEqual({ kind: "success", text: "answer" });
    const options = generate.mock.calls[0]![0];
    expect(options.maxRetries).toBe(0);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("retries a 503 once and succeeds", async () => {
    generate
      .mockRejectedValueOnce(upstream(503))
      .mockResolvedValueOnce({ text: "ok" } as Awaited<ReturnType<typeof generateText>>);
    expect(await call()).toEqual({ kind: "success", text: "ok" });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]![0].abortSignal).not.toBe(generate.mock.calls[0]![0].abortSignal);
  });

  it("reports the 503 when the retry then times out", async () => {
    generate.mockRejectedValueOnce(upstream(503)).mockRejectedValueOnce(timeout());
    expect(await call()).toEqual({ kind: "upstream_error", status: 503 });
  });

  it("is a transport failure only when no attempt got an answer", async () => {
    generate.mockRejectedValue(timeout());
    expect(await call()).toEqual({ kind: "transport_failure" });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 429])("does not retry a %i", async (status) => {
    generate.mockRejectedValue(upstream(status));
    expect(await call()).toEqual({ kind: "upstream_error", status });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
