// @vitest-environment node
// The per-request API key log (#2039) and the granted-key concurrency cap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: { apiRequestLog: { create: vi.fn() } },
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((promise: Promise<unknown>) => void promise),
}));

import prisma from "~/lib/prisma.server";
import { startApiRequestLog } from "~/lib/api-keys/request-log.server";
import {
  getGrantedKeyInflight,
  resetGrantedKeySlots,
  tryAcquireGrantedKeySlot,
} from "~/lib/api-keys/granted-slots.server";

const caller = { userId: "s1", apiKeyId: "k1", grantId: "g1" };

function writtenRows() {
  return vi.mocked(prisma.apiRequestLog.create).mock.calls.map(([args]) => args.data);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.apiRequestLog.create).mockResolvedValue({} as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("startApiRequestLog", () => {
  it("writes one row with the model, status and token usage, never the prompt", () => {
    const log = startApiRequestLog(caller, "/api/completion");
    log.setModel("vllm:qwen3.5-2b-instruct");
    log.setUsage({ promptTokens: 232, completionTokens: 9, totalTokens: 241 });
    log.finish(200);
    log.finish(500);

    expect(writtenRows()).toEqual([
      expect.objectContaining({
        userId: "s1",
        apiKeyId: "k1",
        grantId: "g1",
        route: "/api/completion",
        model: "vllm:qwen3.5-2b-instruct",
        status: 200,
        promptTokens: 232,
        completionTokens: 9,
        totalTokens: 241,
        durationMs: expect.any(Number),
      }),
    ]);
    expect(Object.keys(writtenRows()[0])).not.toContain("content");
  });

  it("derives a missing total and drops unusable counts", () => {
    const log = startApiRequestLog(caller, "/api/completion");
    log.setUsage({ promptTokens: 10, completionTokens: Number.NaN });
    log.finish(200);
    expect(writtenRows()[0]).toMatchObject({
      promptTokens: 10,
      completionTokens: null,
      totalTokens: 10,
    });
  });

  it("logs a failure with no usage as unknown tokens", () => {
    startApiRequestLog(caller, "/api/completion").finish(400);
    expect(writtenRows()[0]).toMatchObject({ status: 400, totalTokens: null });
  });

  it("waits for a streamed answer's usage before writing", async () => {
    const log = startApiRequestLog(caller, "/api/completion");
    log.finishWhenSettled(200, Promise.resolve({ promptTokens: 5, completionTokens: 7 }), 1_000);
    log.finish(200);
    await vi.waitFor(() => expect(prisma.apiRequestLog.create).toHaveBeenCalledTimes(1));
    expect(writtenRows()[0]).toMatchObject({ status: 200, totalTokens: 12 });
  });

  it("writes without tokens when the usage promise never settles (#2009)", async () => {
    vi.useFakeTimers();
    const log = startApiRequestLog(caller, "/api/completion");
    log.finishWhenSettled(200, new Promise(() => {}), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writtenRows()).toEqual([expect.objectContaining({ status: 200, totalTokens: null })]);
  });

  it("writes without tokens when the usage promise rejects", async () => {
    const log = startApiRequestLog(caller, "/api/completion");
    log.finishWhenSettled(200, Promise.reject(new Error("stream failed")), 1_000);
    await vi.waitFor(() => expect(prisma.apiRequestLog.create).toHaveBeenCalledTimes(1));
    expect(writtenRows()[0]).toMatchObject({ totalTokens: null });
  });
});

describe("granted-key slots", () => {
  beforeEach(() => resetGrantedKeySlots());

  it("allows two at once by default and refuses the third", () => {
    const first = tryAcquireGrantedKeySlot();
    const second = tryAcquireGrantedKeySlot();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(tryAcquireGrantedKeySlot()).toBeNull();
    first!();
    expect(tryAcquireGrantedKeySlot()).not.toBeNull();
  });

  it("releases each slot once, however many times release is called", () => {
    const release = tryAcquireGrantedKeySlot()!;
    release();
    release();
    expect(getGrantedKeyInflight()).toBe(0);
  });

  it("follows API_ACCESS_MAX_INFLIGHT, with 0 refusing everything", () => {
    vi.stubEnv("API_ACCESS_MAX_INFLIGHT", "0");
    expect(tryAcquireGrantedKeySlot()).toBeNull();
    vi.stubEnv("API_ACCESS_MAX_INFLIGHT", "3");
    expect([1, 2, 3, 4].map(() => tryAcquireGrantedKeySlot() !== null)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
