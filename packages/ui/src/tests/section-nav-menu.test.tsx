/**
 * `SectionNavMenu` (the Administration menu beside admin pages): the heading
 * names the menu, each link keeps its icon and badge, and the current link is
 * marked by path — or by `activeKey` when the section's pages share one path
 * and differ by `?tab=` (AI Tutor's admin console).
 */
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it } from "vitest";

import { SectionNavMenu } from "../nav-shell/course-nav-menu";
import { NavLinkProvider } from "../nav-shell/nav-shared";
import type { SectionNavConfig } from "../nav-shell/types";

function TestLink({
  to,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return <a {...props} href={to} />;
}

function renderMenu(config: SectionNavConfig, pathname: string) {
  render(
    <NavLinkProvider LinkComponent={TestLink}>
      <SectionNavMenu config={config} pathname={pathname} />
    </NavLinkProvider>,
  );
  return screen.getByRole("navigation", { name: config.title });
}

describe("SectionNavMenu", () => {
  it("marks the link for the current path and shows each link's badge", () => {
    renderMenu(
      {
        title: "Administration",
        links: [
          { key: "users", label: "User Management", href: "/admin/users" },
          {
            key: "bugs",
            label: "Bug Reports",
            href: "/admin/bug-reports",
            badge: <span>6</span>,
          },
        ],
      },
      "/admin/bug-reports",
    );

    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bug Reports/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /Bug Reports/ })).toHaveTextContent("6");
    expect(screen.getByRole("link", { name: "User Management" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks by activeKey when the section's pages share one path", () => {
    renderMenu(
      {
        title: "Administration",
        activeKey: "ai-oversight",
        links: [
          { key: "bug-reports", label: "Bug reports", href: "/admin?tab=bug-reports" },
          { key: "ai-oversight", label: "AI oversight", href: "/admin?tab=ai-oversight" },
        ],
      },
      "/admin",
    );

    expect(screen.getByRole("link", { name: "AI oversight" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Bug reports" })).not.toHaveAttribute("aria-current");
  });
});
