import { describe, expect, it, vi, afterEach } from "vitest";

import { paletteNavItems, loadPaletteCourses } from "~/components/command/command-palette";
import type { User } from "~/lib/auth/types";

// The palette only needs `role` off the user; cast a minimal stub so we don't
// have to build a whole better-auth session object.
const asUser = (role: string) => ({ role }) as unknown as User;

describe("paletteNavItems", () => {
  it("gives a student the core links but no admin links", () => {
    const keys = paletteNavItems(asUser("STUDENT")).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["dashboard", "courses", "chat", "settings"]));
    expect(keys).not.toContain("admin-users");
    expect(keys).not.toContain("admin-ai");
  });

  it("exposes the admin section to an ADMIN", () => {
    const keys = paletteNavItems(asUser("ADMIN")).map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining(["admin-users", "admin-ai", "admin-bugs", "admin-chat", "settings"]),
    );
  });

  it("drops the policy-disabled UNIT_ADMIN invite link", () => {
    // getNavForUser marks the invites link disabled when canInvite is unset,
    // and paletteNavItems must filter disabled entries out entirely.
    const keys = paletteNavItems(asUser("UNIT_ADMIN")).map((i) => i.key);
    expect(keys).not.toContain("unitadmin-invites");
    expect(keys).toEqual(expect.arrayContaining(["dashboard", "courses", "chat", "settings"]));
  });

  it("never surfaces a disabled item", () => {
    for (const role of ["STUDENT", "INSTRUCTOR", "TA", "UNIT_ADMIN", "ADMIN"]) {
      expect(paletteNavItems(asUser(role)).every((i) => !i.disabled)).toBe(true);
    }
  });
});

describe("loadPaletteCourses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const jsonRes = (courses: { id: string; code: string; name: string }[]) =>
    ({ ok: true, json: async () => ({ courses }) }) as unknown as Response;

  it("loads courses once and sets them", async () => {
    const ref = { current: false };
    const setCourses = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonRes([{ id: "1", code: "CPSC 100", name: "Intro" }]));

    await loadPaletteCourses(ref, setCourses, true);
    await loadPaletteCourses(ref, setCourses, true); // second open: guard blocks refetch

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setCourses).toHaveBeenCalledWith([{ id: "1", code: "CPSC 100", name: "Intro" }]);
    expect(ref.current).toBe(true);
  });

  it("does nothing when not open", async () => {
    const ref = { current: false };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes([]));
    await loadPaletteCourses(ref, vi.fn(), false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ref.current).toBe(false);
  });

  it("resets the guard on an HTTP error so the next open retries", async () => {
    const ref = { current: false };
    const setCourses = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce(jsonRes([{ id: "2", code: "CPSC 210", name: "SWE" }]));

    await loadPaletteCourses(ref, setCourses, true);
    expect(ref.current).toBe(false); // 4xx/5xx must not lock out a retry
    expect(setCourses).not.toHaveBeenCalled();

    await loadPaletteCourses(ref, setCourses, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setCourses).toHaveBeenCalledWith([{ id: "2", code: "CPSC 210", name: "SWE" }]);
  });

  it("resets the guard on a network error", async () => {
    const ref = { current: false };
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await loadPaletteCourses(ref, vi.fn(), true);
    expect(ref.current).toBe(false);
  });
});
