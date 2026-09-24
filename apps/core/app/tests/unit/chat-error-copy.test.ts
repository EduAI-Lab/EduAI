// #1510: a failed /api/chat turn used to leave the student with nothing — the
// composer returned to idle and no error text, banner or retry appeared
// anywhere. These tests pin the classification half of the fix: turning the
// `Error` the AI SDK throws for a failed turn into copy a *student* can act on,
// with distinct wording for the three failure modes reproduced in
// tests/e2e/tests/core/week15-student-ta-exploration-round3.spec.ts
// (rate limit, provider down, network unreachable) instead of one generic line.
import { describe, it, expect } from "vitest";

import { describeStudentChatError } from "~/lib/chat-error-copy";

/**
 * `useChat` (AI SDK v4) throws `new Error(await response.text())` for any
 * non-2xx, so a route rejection body round-trips to the client as the error
 * message. Build the errors the same way the SDK does.
 */
function rejectionError(body: Record<string, string | number>): Error {
  return new Error(JSON.stringify(body));
}

/** A browser fetch failure (connection refused / offline) as the SDK rethrows it. */
function networkError(message: string): Error {
  const error = new TypeError(message);
  return error;
}

describe("describeStudentChatError — no notice to show", () => {
  it("returns null when the turn has not failed", () => {
    expect(describeStudentChatError(undefined)).toBeNull();
  });

  it("returns null for an aborted request so pressing Stop shows no error", () => {
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    expect(describeStudentChatError(aborted)).toBeNull();
  });

  it("returns null for the route's REQUEST_ABORTED rejection", () => {
    expect(
      describeStudentChatError(
        rejectionError({ error: "Request aborted", code: "REQUEST_ABORTED" }),
      ),
    ).toBeNull();
  });
});

describe("describeStudentChatError — rate limit", () => {
  it("classifies RATE_LIMITED as rate-limit and names the wait in seconds", () => {
    const notice = describeStudentChatError(
      rejectionError({ error: "RATE_LIMITED", retryAfter: 42 }),
    );

    expect(notice?.kind).toBe("rate-limit");
    expect(notice?.title).toBe("You're sending messages too quickly");
    expect(notice?.description).toMatch(/42 seconds/);
  });

  it("never shows the raw RATE_LIMITED enum to a student", () => {
    const notice = describeStudentChatError(
      rejectionError({ error: "RATE_LIMITED", retryAfter: 42 }),
    );

    expect(notice?.title).not.toMatch(/RATE_LIMITED/);
    expect(notice?.description).not.toMatch(/RATE_LIMITED/);
  });

  it("still gives a wait instruction when the rejection carries no retryAfter", () => {
    const notice = describeStudentChatError(rejectionError({ error: "RATE_LIMITED" }));

    expect(notice?.kind).toBe("rate-limit");
    expect(notice?.description).toMatch(/wait a moment and try again/i);
  });

  it("distinguishes a saturated job queue from the student's own rate limit", () => {
    const notice = describeStudentChatError(
      rejectionError({ error: "AI job queue is full", retryAfterSeconds: 15 }),
    );

    expect(notice?.kind).toBe("rate-limit");
    expect(notice?.title).toBe("EduAI is busy right now");
    expect(notice?.description).toMatch(/15 seconds/);
  });
});

describe("describeStudentChatError — provider down", () => {
  const providerCodes = [
    "LLM_STREAM_FAILED",
    "LLM_PROVIDER_SETUP_FAILED",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_TIMEOUT",
    "PROVIDER_REQUEST_FAILED",
    "MODEL_UNAVAILABLE",
    "INVALID_PROVIDER_CONFIG",
  ];

  for (const code of providerCodes) {
    it(`classifies ${code} as provider-down`, () => {
      const notice = describeStudentChatError(
        rejectionError({ error: "Provider request failed", code }),
      );

      expect(notice?.kind).toBe("provider-down");
      expect(notice?.title).toBe("The AI model isn't responding");
    });
  }

  it("tells the student it is not their question that failed", () => {
    const notice = describeStudentChatError(
      rejectionError({ error: "LLM stream failed: fetch failed.", code: "LLM_STREAM_FAILED" }),
    );

    expect(notice?.description).toMatch(/not (a problem )?with your question/i);
  });

  it("hides the raw provider diagnostic from the student", () => {
    const notice = describeStudentChatError(
      rejectionError({ error: "LLM stream failed: fetch failed.", code: "LLM_STREAM_FAILED" }),
    );

    expect(notice?.description).not.toMatch(/fetch failed/);
  });

  it("classifies an uncoded 'provider is not available on this server' 400 as provider-down", () => {
    // The real 400 body for an unconfigured model carries no `code` at all —
    // classifying on `code` alone would file this under the generic branch and
    // dump the VLLM_BASE_URL setup instructions into a student's chat window.
    const notice = describeStudentChatError(
      rejectionError({
        error:
          'Provider "vllm" is not available on this server. Set VLLM_BASE_URL in apps/core/.env and restart the dev process.',
      }),
    );

    expect(notice?.kind).toBe("provider-down");
    expect(notice?.description).not.toMatch(/VLLM_BASE_URL/);
  });
});

describe("describeStudentChatError — network", () => {
  for (const message of [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ]) {
    it(`classifies the browser fetch failure "${message}" as network`, () => {
      const notice = describeStudentChatError(networkError(message));

      expect(notice?.kind).toBe("network");
      expect(notice?.title).toBe("Couldn't reach EduAI");
      expect(notice?.description).toMatch(/connection/i);
    });
  }

  it("does not mistake a JSON body mentioning fetch for a network failure", () => {
    // Guards ordering: the 502 stream-failure body literally contains the
    // words "fetch failed", so a message-substring check that ran before the
    // JSON parse would misfile every provider outage as the student's wifi.
    const notice = describeStudentChatError(
      rejectionError({ error: "LLM stream failed: fetch failed.", code: "LLM_STREAM_FAILED" }),
    );

    expect(notice?.kind).toBe("provider-down");
  });
});

describe("describeStudentChatError — generic fallback", () => {
  it("passes through an actionable server message the student can act on", () => {
    const notice = describeStudentChatError(
      rejectionError({
        error: "Select a course before asking a question.",
        code: "COURSE_REQUIRED",
      }),
    );

    expect(notice?.kind).toBe("generic");
    expect(notice?.title).toBe("Couldn't get a response");
    expect(notice?.description).toBe("Select a course before asking a question.");
  });

  it("falls back to a non-JSON error message rather than showing nothing", () => {
    const notice = describeStudentChatError(new Error("Internal Server Error"));

    expect(notice?.kind).toBe("generic");
    expect(notice?.description).toBe("Internal Server Error");
  });

  it("still produces a notice when the error carries no message at all", () => {
    const notice = describeStudentChatError(new Error(""));

    expect(notice?.kind).toBe("generic");
    expect(notice?.description).toMatch(/try again/i);
  });
});
