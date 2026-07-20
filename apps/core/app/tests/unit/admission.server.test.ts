import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdmissionTimeoutError,
  acquireAiAdmission,
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
});
