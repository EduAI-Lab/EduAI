// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const queueCtor = vi.hoisted(() => vi.fn());

vi.mock("bullmq", () => ({
  Queue: class {
    constructor(...args: unknown[]) {
      queueCtor(...args);
    }
  },
}));
vi.mock("~/lib/queue/connection.server", () => ({ default: {} }));

import { getQueue } from "~/lib/queue/queues.server";

beforeEach(() => {
  queueCtor.mockClear();
});

describe("getQueue", () => {
  it("builds one Queue per pool and reuses it across calls", () => {
    const first = getQueue("ai-jobs:chat");
    const second = getQueue("ai-jobs:chat");

    expect(second).toBe(first);
    expect(queueCtor).toHaveBeenCalledTimes(1);
  });

  it("keeps the singleton in production (the registry is not dev-only)", () => {
    // Drop the globalThis handle so the only surviving cache is the module-level
    // registry — that is what a production process relies on.
    const parked = globalThis.__aiJobQueues;
    delete globalThis.__aiJobQueues;
    vi.stubEnv("NODE_ENV", "production");
    try {
      const first = getQueue("ai-jobs:heavy");
      const second = getQueue("ai-jobs:heavy");

      expect(second).toBe(first);
      expect(queueCtor).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      globalThis.__aiJobQueues = parked;
    }
  });

  it("keeps separate queues per pool", () => {
    expect(getQueue("ai-jobs:chat")).not.toBe(getQueue("ai-jobs:heavy"));
  });
});
