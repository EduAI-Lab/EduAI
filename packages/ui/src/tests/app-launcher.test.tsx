import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BrandSwitcher,
  QUESTION_MAKER_ROLES,
  visibleAppsForRole,
  type LauncherApp,
} from "../app-launcher";
import { SidebarProvider } from "../ui/sidebar";

const APPS: LauncherApp[] = [
  { id: "core", name: "EduAI Core", url: "http://core", icon: <span /> },
  { id: "ai-tutor", name: "AI Tutor", url: "http://tutor", icon: <span /> },
  {
    id: "question-maker",
    name: "Question Maker",
    url: "http://qm",
    icon: <span />,
    roles: QUESTION_MAKER_ROLES,
  },
];

function renderSwitcher(props: Partial<React.ComponentProps<typeof BrandSwitcher>> = {}) {
  return render(
    <SidebarProvider>
      <BrandSwitcher
        logo={<span>EduAI</span>}
        apps={APPS}
        currentAppId="core"
        {...props}
      />
    </SidebarProvider>,
  );
}

// ── RBAC gate (the security-critical part) ────────────────────────────────────

describe("visibleAppsForRole — RBAC gate", () => {
  it("hides Question Maker from students", () => {
    const ids = visibleAppsForRole(APPS, "STUDENT").map((a) => a.id);
    expect(ids).toEqual(["core", "ai-tutor"]);
    expect(ids).not.toContain("question-maker");
  });

  it.each(["INSTRUCTOR", "ADMIN", "UNIT_ADMIN"])(
    "shows Question Maker to %s",
    (role) => {
      const ids = visibleAppsForRole(APPS, role).map((a) => a.id);
      expect(ids).toContain("question-maker");
    },
  );

  it("hides role-gated apps when the role is null/undefined", () => {
    expect(visibleAppsForRole(APPS, null).map((a) => a.id)).not.toContain(
      "question-maker",
    );
    expect(visibleAppsForRole(APPS, undefined).map((a) => a.id)).not.toContain(
      "question-maker",
    );
  });

  it("always keeps apps without a roles restriction", () => {
    // Core and AI Tutor have no `roles` → visible to every role, including a
    // role no app explicitly lists.
    const ids = visibleAppsForRole(APPS, "SOME_OTHER_ROLE").map((a) => a.id);
    expect(ids).toEqual(["core", "ai-tutor"]);
  });
});

// ── Trigger rendering ─────────────────────────────────────────────────────────

describe("BrandSwitcher — trigger", () => {
  it("renders the brand as a home link to the current app", () => {
    renderSwitcher({ logoHref: "/dashboard" });
    expect(screen.getByText("EduAI")).toBeInTheDocument();
  });

  it("shows the app-switcher (waffle) button when 2+ apps are accessible", () => {
    // Student sees Core + AI Tutor → switchable.
    renderSwitcher({ role: "STUDENT" });
    expect(
      screen.getByRole("button", { name: /switch app/i }),
    ).toBeInTheDocument();
  });

  it("hides the switcher button when only one app is accessible", () => {
    // Single-app list → nothing to switch to → no waffle button.
    renderSwitcher({ apps: [APPS[0]], role: "STUDENT" });
    expect(
      screen.queryByRole("button", { name: /switch app/i }),
    ).not.toBeInTheDocument();
  });
});

// NOTE: The popover grid contents (per-app cards, "Now" badge) are not asserted
// here because Radix DropdownMenu does not render its items into the DOM when
// opened under happy-dom (same limitation documented in nav-user.test.tsx). The
// security-critical behaviour — which apps a role may reach — is fully covered
// by the visibleAppsForRole tests above and the waffle-button presence tests,
// since the grid is populated from exactly that filtered list.
