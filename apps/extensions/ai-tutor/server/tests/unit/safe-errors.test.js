import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeErrorMetadata, logSafeError, sendSafeError } from "../../src/utils/safeErrors.js";

describe("safe route error boundaries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops internal messages, stacks, causes, and untrusted codes from diagnostics", () => {
    const canary = "SECRET_DB_PASSWORD /srv/private/query-engine stack";
    const error = Object.assign(new Error(canary), {
      status: 503,
      code: canary,
      cause: new Error(canary),
      stack: `${canary}\n at privateQuery (db.js:1:1)`,
    });

    expect(getSafeErrorMetadata(error)).toEqual({ status: 503 });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    logSafeError("[activities] route failed", error);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(canary);
  });

  it("preserves an intentional status and stable public fallback response", () => {
    const error = Object.assign(new Error("internal-only"), { status: 409 });
    const response = sendSafeError(
      {
        status(status) {
          expect(status).toBe(409);
          return {
            json(body) {
              return body;
            },
          };
        },
      },
      error,
      "Activity update failed",
      { status: 409 },
    );

    expect(response).toEqual({ error: "Activity update failed" });
  });
});
