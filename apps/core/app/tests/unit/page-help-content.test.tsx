import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { getCorePageHelp } from "~/components/help/page-help-content";
import { HelpView } from "~/components/help/help-view";

/** Every authenticated Core screen that renders `CoreAppShell` (and so the header help button). */
const SHELL_ROUTES = [
  "/dashboard",
  "/courses",
  "/courses/abc123",
  "/chat",
  "/chat/xyz",
  "/instructor/chat",
  "/units/CMPS/chats",
  "/settings",
  "/status",
  "/help",
  "/admin/users",
  "/admin/invitations",
  "/unit-admin/invitations",
  "/admin/ai-models",
  "/admin/settings",
  "/admin/chat",
  "/admin/bug-reports",
  "/admin/logs",
  "/admin/cron-jobs",
];

const FALLBACK_TITLE = getCorePageHelp("/definitely-not-a-route").title;

describe("getCorePageHelp", () => {
  it.each(SHELL_ROUTES)("has page-specific help for %s", (pathname) => {
    const help = getCorePageHelp(pathname, "ADMIN");
    expect(help.title).not.toBe(FALLBACK_TITLE);
    expect(help.summary.length).toBeGreaterThan(0);
  });

  it("words the course workspace for staff and the course view for students", () => {
    expect(getCorePageHelp("/courses/abc", "INSTRUCTOR").title).toBe("Course workspace");
    expect(getCorePageHelp("/courses/abc", "STUDENT").title).toBe("Your course");
    expect(getCorePageHelp("/courses/abc", null).title).toBe("Your course");
  });

  it("does not mistake /courses/self-enroll-style nested paths for the workspace", () => {
    expect(getCorePageHelp("/courses/abc/extra", "ADMIN").title).toBe(FALLBACK_TITLE);
  });

  it("deep-links only to sections that exist on the /help page", () => {
    const router = createMemoryRouter([{ path: "/", element: <HelpView role="ADMIN" /> }]);
    const { container } = render(<RouterProvider router={router} />);

    const hrefs = new Set(
      [...SHELL_ROUTES, "/nowhere"].flatMap((p) => [
        getCorePageHelp(p, "ADMIN").helpHref,
        getCorePageHelp(p, "STUDENT").helpHref,
      ]),
    );
    for (const href of hrefs) {
      expect(href).toMatch(/^\/help#/);
      const id = href!.split("#")[1];
      expect(container.querySelector(`#${id}`), `missing /help section #${id}`).not.toBeNull();
    }
  });
});
