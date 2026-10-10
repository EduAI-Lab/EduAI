import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { HelpView } from "~/components/help/HelpView";
import { getAiTutorPageHelp } from "~/lib/help/page-help-content";

/** Every screen mounted inside the `_app` shell (and so the header help button). */
const SHELL_ROUTES = [
  "/dashboard",
  "/admin",
  "/settings",
  "/help",
  "/student",
  "/student/courses/1",
  "/student/module/2",
  "/student/lesson/3",
  "/instructor",
  "/instructor/courses/1",
  "/instructor/module/2",
  "/instructor/lesson/3",
];

const FALLBACK_TITLE = getAiTutorPageHelp("/no-such-page").title;

describe("getAiTutorPageHelp", () => {
  it.each(SHELL_ROUTES)("has page-specific help for %s", (pathname) => {
    expect(getAiTutorPageHelp(pathname, "STUDENT").title).not.toBe(FALLBACK_TITLE);
  });

  it("words the dashboard for learners and for staff", () => {
    expect(getAiTutorPageHelp("/dashboard", "STUDENT").summary).toMatch(/progress/);
    expect(getAiTutorPageHelp("/dashboard", "INSTRUCTOR").summary).toMatch(/attention/);
  });

  it("deep-links only to sections that exist on the /help page", () => {
    const { container } = render(
      <MemoryRouter>
        <HelpView role="ADMIN" />
      </MemoryRouter>,
    );
    const hrefs = new Set(
      [...SHELL_ROUTES, "/no-such-page"].map((p) => getAiTutorPageHelp(p, "ADMIN").helpHref),
    );
    for (const href of hrefs) {
      expect(href).toMatch(/^\/help#/);
      const id = href!.split("#")[1];
      expect(container.querySelector(`#${id}`), `missing /help section #${id}`).not.toBeNull();
    }
  });
});
