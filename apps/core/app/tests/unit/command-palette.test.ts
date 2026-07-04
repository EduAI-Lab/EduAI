import { describe, expect, it } from "vitest";

import { paletteNavItems } from "~/components/command/command-palette";
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
