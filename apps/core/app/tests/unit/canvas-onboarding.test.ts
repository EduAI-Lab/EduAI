import { describe, expect, it } from "vitest";

import {
  STUDENT_ID_ONBOARDING_SKIP_COOKIE,
  studentIdOnboardingSkipCookieHeader,
} from "~/lib/canvas/onboarding.server";

describe("studentIdOnboardingSkipCookieHeader", () => {
  it("sets a skip cookie the redirect helper recognizes", () => {
    const header = studentIdOnboardingSkipCookieHeader();

    expect(header).toContain(`${STUDENT_ID_ONBOARDING_SKIP_COOKIE}=1`);
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=Lax");
  });
});
