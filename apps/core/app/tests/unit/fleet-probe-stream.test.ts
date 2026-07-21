import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamStartupProbe } from "~/lib/ai/routing/fleet/probe-stream";

describe("createStreamStartupProbe", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when signalReady is called", async () => {
    const probe = createStreamStartupProbe({ timeoutMs: 5_000 });
    const waited = probe.wait();
    probe.hooks.signalReady();
    await expect(waited).resolves.toBeUndefined();
  });

  it("rejects when signalError is called before ready", async () => {
    const probe = createStreamStartupProbe({ timeoutMs: 5_000 });
    const waited = probe.wait();
    probe.hooks.signalError(new Error("connection refused"));
    await expect(waited).rejects.toThrow("connection refused");
  });

  it("ignores error after ready", async () => {
    const probe = createStreamStartupProbe({ timeoutMs: 5_000 });
    const waited = probe.wait();
    probe.hooks.signalReady();
    probe.hooks.signalError(new Error("late"));
    await expect(waited).resolves.toBeUndefined();
  });

  it("soft-times out as ready (deliberate: slow hosts are not retried; late errors after this cannot retry)", async () => {
    vi.useFakeTimers();
    const probe = createStreamStartupProbe({ timeoutMs: 50 });
    const waited = probe.wait();
    await vi.advanceTimersByTimeAsync(50);
    await expect(waited).resolves.toBeUndefined();
  });
});
