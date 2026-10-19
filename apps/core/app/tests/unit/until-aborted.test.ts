import { describe, expect, it } from "vitest";
import { untilAborted } from "~/lib/ai/until-aborted";

// #2009: AI SDK 4 leaves a stream result's promises pending forever after an
// abort; untilAborted turns that hang into an AbortError the callers handle.
describe("untilAborted", () => {
  it("resolves with the promise's value when nothing aborts", async () => {
    await expect(untilAborted(Promise.resolve(7), new AbortController().signal)).resolves.toBe(7);
  });

  it("passes the promise's own rejection through", async () => {
    const failure = new Error("provider failed");
    await expect(untilAborted(Promise.reject(failure), new AbortController().signal)).rejects.toBe(
      failure,
    );
  });

  it("rejects with an AbortError when the signal aborts while the promise is pending forever", async () => {
    const controller = new AbortController();
    const waiting = untilAborted(new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects straight away when the signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(untilAborted(new Promise(() => {}), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("returns the promise itself when there is no signal", () => {
    const promise = Promise.resolve(1);
    expect(untilAborted(promise, undefined)).toBe(promise);
  });
});
