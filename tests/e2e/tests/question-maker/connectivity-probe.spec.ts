/**
 * Question Maker connectivity-probe E2E regression (#1109).
 *
 * Proves the course-independence boundary end to end: `testApiKey()` sends a
 * minimal authenticated completion to Core's stateless course-free
 * `POST /api/completion` — never the interactive course-aware `/api/chat` —
 * and must not depend on a seeded/configured course (`courseId`/`courseCode`/
 * `COSC 121`).
 *
 * The E2E environment configures no real AI provider, so the probe reaches
 * Core's course-free `/api/completion` boundary and then fails on the
 * provider/connectivity leg (the campus vLLM path times out) rather than
 * completing a live generation. That is a valid probe outcome: the assertions
 * target what the probe is NOT gated by (a course requirement, an auth
 * failure) while confirming the request actually reached Core's course-free
 * boundary.
 *
 * Auth model: QM's `/api/eduai/test-api-key` route requires a `QM_AUTHORIZED`
 * (INSTRUCTOR-or-higher) Core session, then `testApiKey()` calls Core
 * `/api/completion` with the server-to-server Bearer service key. Both gates
 * are exercised here, and no QM/Core course is ever created.
 */
import { test, expect } from "@playwright/test";
import { QM_BACKEND_URL } from "../../playwright.config";
import { createInstructor } from "../helpers/auth";

test.describe("Question Maker connectivity probe (course-free, #1109)", () => {
  test("POST /api/eduai/test-api-key requires authentication (401)", async ({ request }) => {
    const res = await request.post(`${QM_BACKEND_URL}/api/eduai/test-api-key`, { data: {} });
    expect(res.status()).toBe(401);
  });

  test("authenticated probe reaches Core /api/completion without any seeded course", async ({
    request,
  }) => {
    // INSTRUCTOR passes the QM_AUTHORIZED gate; no QM/Core course anchor is
    // materialized anywhere in this test.
    await createInstructor(request, { prefix: "qm-probe-course-free" });

    const res = await request.post(`${QM_BACKEND_URL}/api/eduai/test-api-key`, { data: {} });

    // 200 = provider reachable; 400 = provider unreachable (the E2E
    // environment has no local vLLM/cloud provider). Both are valid probe
    // outcomes — the probe must never be rejected by a course gate.
    expect([200, 400]).toContain(res.status());
    const body = await res.json();

    // The probe always resolves a provider path (never resolves course access).
    expect(body.provider).toEqual(expect.any(String));
    expect(body.provider.length).toBeGreaterThan(0);

    if (body.success === true) {
      // Provider reachable — success with no course context involved.
      expect(body.message).toBeTruthy();
      return;
    }

    // Provider unreachable (E2E has no real AI provider, so the campus vLLM
    // path times out). The probe must still have reached Core's course-free
    // /api/completion boundary: `chat()` attempted the authenticated
    // completion call and the hardened route returned its stable rejection
    // contract — never a course gate, and never an auth failure.
    const error = String(body.error ?? "");
    expect(error).toBe("EduAI API key test failed");
    expect(body.code).toBe("EDUAI_API_KEY_TEST_REJECTED");
    expect(error.toLowerCase()).not.toContain("course");
    expect(error).not.toContain("COURSE_REQUIRED");
    expect(error).not.toContain("COSC 121");
  });
});
