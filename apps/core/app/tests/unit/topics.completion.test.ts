import { describe, it, expect, vi, beforeEach } from "vitest";

const runCompletion = vi.hoisted(() => vi.fn());
vi.mock("~/lib/ai/completion.server", () => ({ runCompletion }));

const { runTopicAnalysisCompletion, TopicAnalysisProviderError } =
  await import("~/lib/topics/completion.server");

const args = { systemPrompt: "system", prompt: "prompt" };

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The distinction under test (#1624 review): a provider that failed and a model
 * that had nothing to say are different outcomes. Collapsing both to null wrote
 * a misconfigured provider down as a COMPLETED job with zero topics, so the
 * instructor never got the failure notice or the retry action.
 */
describe("runTopicAnalysisCompletion", () => {
  it("returns the model's content on success", async () => {
    runCompletion.mockResolvedValue({
      ok: true,
      streaming: false,
      body: { content: '{"topics":["Chapter 1"]}' },
    });

    expect(await runTopicAnalysisCompletion(args)).toBe('{"topics":["Chapter 1"]}');
  });

  it("returns null when the model answered with nothing", async () => {
    runCompletion.mockResolvedValue({ ok: true, streaming: false, body: { content: null } });

    expect(await runTopicAnalysisCompletion(args)).toBeNull();
  });

  it("throws on a provider failure rather than reporting an empty result", async () => {
    runCompletion.mockResolvedValue({ ok: false, status: 503, error: "provider unreachable" });

    await expect(runTopicAnalysisCompletion(args)).rejects.toBeInstanceOf(
      TopicAnalysisProviderError,
    );
  });

  it("carries the provider's status and message onto the error", async () => {
    runCompletion.mockResolvedValue({ ok: false, status: 401, error: "invalid api key" });

    await expect(runTopicAnalysisCompletion(args)).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("invalid api key"),
    });
  });

  it("throws on a misconfiguration that returned a streaming body", async () => {
    runCompletion.mockResolvedValue({ ok: true, streaming: true, body: {} });

    await expect(runTopicAnalysisCompletion(args)).rejects.toBeInstanceOf(
      TopicAnalysisProviderError,
    );
  });
});
