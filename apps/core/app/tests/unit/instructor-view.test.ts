// @vitest-environment node
//
// #1843 — the admin/instructor view switch must change presentation only. The
// rule below is the whole authorization surface of that switch, so it is
// tested as a pure function rather than through the route.

import { describe, expect, it } from "vitest";

import {
  canSwitchToInstructorView,
  canUseInstructorChatMode,
} from "~/lib/rbac/instructor-view.server";

describe("canUseInstructorChatMode", () => {
  it("admits a real course instructor, as it always did", () => {
    expect(canUseInstructorChatMode("instructor", true, true)).toBe(true);
    // Their level already proves the enrollment; the flag is not consulted.
    expect(canUseInstructorChatMode("instructor", true, false)).toBe(true);
  });

  it("admits an ADMIN who actually teaches the course", () => {
    // The point of #1843: `resolveAccess` short-circuits ADMIN to `admin` and
    // never reads the enrollment, so this account could not reach the
    // instructor surface however it was enrolled.
    expect(canUseInstructorChatMode("admin", true, true)).toBe(true);
  });

  it("admits an in-unit UNIT_ADMIN who actually teaches the course", () => {
    expect(canUseInstructorChatMode("unit", true, true)).toBe(true);
  });

  it("REFUSES an ADMIN who does not teach the course", () => {
    // This is the guarantee the AC asks for: the switch grants nothing. An
    // admin may administer every course, but may only take the instructor view
    // of one they hold a real enrollment on.
    expect(canUseInstructorChatMode("admin", true, false)).toBe(false);
    expect(canUseInstructorChatMode("unit", true, false)).toBe(false);
  });

  it("refuses an unpublished course for every caller", () => {
    expect(canUseInstructorChatMode("instructor", false, true)).toBe(false);
    expect(canUseInstructorChatMode("admin", false, true)).toBe(false);
    expect(canUseInstructorChatMode("unit", false, true)).toBe(false);
  });

  it("refuses TA and student levels even with an enrollment flag set", () => {
    // `ta`/`student` are real answers from the resolver, not short-circuits, so
    // they must never be widened. A true flag here would be contradictory
    // input; the rule still refuses rather than trusting it.
    expect(canUseInstructorChatMode("ta", true, true)).toBe(false);
    expect(canUseInstructorChatMode("student", true, true)).toBe(false);
  });

  it("refuses a caller with no access at all", () => {
    expect(canUseInstructorChatMode(null, true, true)).toBe(false);
  });
});

describe("canSwitchToInstructorView", () => {
  it("offers the switch to an ADMIN or UNIT_ADMIN who teaches something", () => {
    expect(canSwitchToInstructorView("ADMIN", 1)).toBe(true);
    expect(canSwitchToInstructorView("UNIT_ADMIN", 3)).toBe(true);
  });

  it("does not offer it to an account that teaches nothing", () => {
    expect(canSwitchToInstructorView("ADMIN", 0)).toBe(false);
    expect(canSwitchToInstructorView("UNIT_ADMIN", 0)).toBe(false);
  });

  it("does not offer it to a plain INSTRUCTOR, who is already there", () => {
    expect(canSwitchToInstructorView("INSTRUCTOR", 4)).toBe(false);
  });

  it("does not offer it to a student, a TA, or an unknown role", () => {
    expect(canSwitchToInstructorView("STUDENT", 0)).toBe(false);
    expect(canSwitchToInstructorView("TA", 2)).toBe(false);
    expect(canSwitchToInstructorView(null, 2)).toBe(false);
    expect(canSwitchToInstructorView(undefined, 2)).toBe(false);
  });
});
