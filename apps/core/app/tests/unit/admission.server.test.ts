import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdmissionTimeoutError,
  acquireAiAdmission,
  admissionRetryAfterSeconds,
  admissionTimeoutResponse,
  getAiAdmissionStats,
  resetAiAdmission,
  withAdmissionRelease,
} from "~/lib/ai/admission.server";

describe("AI admission", () => {
  const originalMax = process.env.AI_MAX_INFLIGHT;
  const originalWait = process.env.AI_ADMISSION_WAIT_MS;

  afterEach(() => {
    resetAiAdmission();
    if (originalMax === undefined) delete process.env.AI_MAX_INFLIGHT;
    else process.env.AI_MAX_INFLIGHT = originalMax;
    if (originalWait === undefined) delete process.env.AI_ADMISSION_WAIT_MS;
    else process.env.AI_ADMISSION_WAIT_MS = originalWait;
  });

  it("allows up to AI_MAX_INFLIGHT concurrent slots", async () => {
    process.env.AI_MAX_INFLIGHT = "2";
    const a = await acquireAiAdmission();
    const b = await acquireAiAdmission();
    expect(getAiAdmissionStats().inflight).toBe(2);
    a.release();
    expect(getAiAdmissionStats().inflight).toBe(1);
    b.release();
    expect(getAiAdmissionStats().inflight).toBe(0);
  });

  it("queues and resumes when a slot frees", async () => {
    process.env.AI_MAX_INFLIGHT = "1";
    process.env.AI_ADMISSION_WAIT_MS = "2000";
    const first = await acquireAiAdmission();
    const pending = acquireAiAdmission();
    expect(getAiAdmissionStats().queued).toBe(1);
    first.release();
    const second = await pending;
    expect(getAiAdmissionStats().inflight).toBe(1);
    second.release();
  });

  it("times out waiters with AdmissionTimeoutError", async () => {
    process.env.AI_MAX_INFLIGHT = "1";
    process.env.AI_ADMISSION_WAIT_MS = "30";
    const first = await acquireAiAdmission();
    await expect(acquireAiAdmission()).rejects.toBeInstanceOf(AdmissionTimeoutError);
    first.release();
  });

  it("disables when AI_MAX_INFLIGHT=0", async () => {
    process.env.AI_MAX_INFLIGHT = "0";
    const a = await acquireAiAdmission();
    const b = await acquireAiAdmission();
    expect(getAiAdmissionStats().inflight).toBe(0);
    a.release();
    b.release();
  });

  it("withAdmissionRelease invokes release when stream completes", async () => {
    const release = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("ok"));
        controller.close();
      },
    });
    const wrapped = withAdmissionRelease(new Response(body), release);
    await wrapped.text();
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it("withAdmissionRelease cancels the upstream reader before releasing on cancel", async () => {
    let upstreamCancelled = false;
    const release = vi.fn();
    const body = new ReadableStream({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode("chunk"));
        // Keep the stream open until cancelled.
      },
      cancel() {
        upstreamCancelled = true;
      },
    });

    const wrapped = withAdmissionRelease(new Response(body), release);
    await wrapped.body!.cancel();

    await vi.waitFor(() => {
      expect(upstreamCancelled).toBe(true);
      expect(release).toHaveBeenCalledTimes(1);
    });
  });

  it("releases the slot when the request aborts even if the response body is not cancelled", async () => {
    let upstreamCancelled = false;
    const release = vi.fn();
    const controller = new AbortController();
    const body = new ReadableStream({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode("chunk"));
      },
      cancel() {
        upstreamCancelled = true;
      },
    });

    withAdmissionRelease(new Response(body), release, controller.signal);
    controller.abort();

    await vi.waitFor(() => {
      expect(upstreamCancelled).toBe(true);
      expect(release).toHaveBeenCalledTimes(1);
    });
  });

  it("removes aborted waiters from the FIFO queue", async () => {
    process.env.AI_MAX_INFLIGHT = "1";
    process.env.AI_ADMISSION_WAIT_MS = "2000";
    const first = await acquireAiAdmission();
    const controller = new AbortController();
    const pending = acquireAiAdmission(controller.signal);
    expect(getAiAdmissionStats().queued).toBe(1);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(getAiAdmissionStats().queued).toBe(0);

    const next = acquireAiAdmission();
    first.release();
    const admitted = await next;
    expect(getAiAdmissionStats().inflight).toBe(1);
    admitted.release();
  });
});

/**
 * #1804: the admission 503 carried no `Retry-After`, so a client had nothing to
 * back off against and retried straight back into the same queue — six
 * consecutive 503s over 138s in the COSC 301 pilot report. Both `/api/chat` and
 * `/api/completion` now share one builder so they cannot drift.
 */
describe("admission timeout response", () => {
  const originalWait = process.env.AI_ADMISSION_WAIT_MS;

  afterEach(() => {
    if (originalWait === undefined) delete process.env.AI_ADMISSION_WAIT_MS;
    else process.env.AI_ADMISSION_WAIT_MS = originalWait;
  });

  it("is a 503 carrying Retry-After and the same code as before", async () => {
    process.env.AI_ADMISSION_WAIT_MS = "15000";
    const response = admissionTimeoutResponse();

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(15);

    const body = await response.json();
    expect(body.code).toBe("AI_ADMISSION_TIMEOUT");
    // The header and the body must agree, or a client that trusts one backs off
    // differently from a client that trusts the other.
    expect(body.retryAfter).toBe(retryAfter);
  });

  it("bases the delay on the configured admission window", () => {
    process.env.AI_ADMISSION_WAIT_MS = "30000";
    // No jitter, so the base is observable on its own.
    expect(admissionRetryAfterSeconds(0)).toBe(30);

    process.env.AI_ADMISSION_WAIT_MS = "5000";
    expect(admissionRetryAfterSeconds(0)).toBe(5);
  });

  it("never suggests retrying immediately", () => {
    // A sub-second window would otherwise round down to `Retry-After: 0`, which
    // is an invitation to hot-loop.
    process.env.AI_ADMISSION_WAIT_MS = "200";
    expect(admissionRetryAfterSeconds(0)).toBe(1);

    process.env.AI_ADMISSION_WAIT_MS = "0";
    expect(admissionRetryAfterSeconds(0)).toBe(1);
  });

  it("spreads retries across the window instead of re-synchronizing them", () => {
    process.env.AI_ADMISSION_WAIT_MS = "20000";

    // A fixed delay would send every client back at the same instant; the pilot
    // scenario is 25 clients against 8 slots.
    expect(admissionRetryAfterSeconds(0.5, () => 0)).toBe(20);
    expect(admissionRetryAfterSeconds(0.5, () => 0.999)).toBe(29);

    const spread = new Set(
      Array.from({ length: 50 }, (_, i) => admissionRetryAfterSeconds(0.5, () => i / 50)),
    );
    expect(spread.size).toBeGreaterThan(1);
    for (const value of spread) {
      expect(value).toBeGreaterThanOrEqual(20);
      expect(value).toBeLessThanOrEqual(30);
    }
  });
});
