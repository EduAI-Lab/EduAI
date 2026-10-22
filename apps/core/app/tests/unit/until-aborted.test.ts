import { describe, expect, it } from "vitest";
import { raceStreamFailure, untilAborted } from "~/lib/ai/until-aborted";

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

  // CI (merge queue, 2026-10-21): with the signal already aborted, untilAborted
  // returned without handling the promise; when it rejected later (the stream's
  // onError reporting the abort), Node exited on the unhandled rejection and
  // took Core down mid-E2E-run.
  it("leaves no unhandled rejection when the signal had already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let rejectLater: (error: Error) => void = () => {};
    const later = new Promise<never>((_, reject) => {
      rejectLater = reject;
    });

    await expect(untilAborted(later, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    rejectLater(new Error("the stream reported the abort afterwards"));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("returns the promise itself when there is no signal", () => {
    const promise = Promise.resolve(1);
    expect(untilAborted(promise, undefined)).toBe(promise);
  });
});

// #2009: a provider error inside the stream leaves the result promises pending
// forever too; the failure promise ends the wait at once.
describe("raceStreamFailure", () => {
  it("resolves with every value when nothing fails", async () => {
    const neverFails = new Promise<never>(() => {});
    await expect(raceStreamFailure(neverFails, [Promise.resolve("text"), 3])).resolves.toEqual([
      "text",
      3,
    ]);
  });

  it("rejects with the stream's error even though the values never settle", async () => {
    const error = new Error("maximum context length is 16384 tokens");
    const failed = Promise.reject(error) as Promise<never>;
    await expect(raceStreamFailure(failed, [new Promise(() => {})])).rejects.toBe(error);
  });
});
