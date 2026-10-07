import { describe, expect, it } from "vitest";

import { getQmPageHelp } from "@/lib/pageHelpContent";

const FALLBACK_TITLE = getQmPageHelp("/no-such-page").title;

/** Every screen mounted inside `QmAppLayout` (and so the header help button). */
const SHELL_ROUTES = [
  "/dashboard",
  "/courses",
  "/courses/7",
  "/courses/7/questions/new",
  "/courses/7/questions/12/edit",
  "/courses/7/banks/3",
  "/courses/7/assessments/9",
  "/courses/7/assessments/9/variants",
  "/courses/7/assessments/variants",
  "/assessments/9/builder",
  "/library",
  "/settings",
  "/help",
  "/admin/bug-reports",
];

describe("getQmPageHelp", () => {
  it.each(SHELL_ROUTES)("has page-specific help for %s", (pathname) => {
    expect(getQmPageHelp(pathname).title).not.toBe(FALLBACK_TITLE);
  });

  it("follows the course workspace's active tab", () => {
    expect(getQmPageHelp("/courses/7", "?tab=questions").title).toBe("Questions");
    expect(getQmPageHelp("/courses/7", "?tab=banks").title).toBe("Question banks");
    expect(getQmPageHelp("/courses/7", "?tab=assessments").title).toBe("Assessments");
    expect(getQmPageHelp("/courses/7", "?tab=canvas").title).toBe("Canvas");
  });

  it("treats a missing or unknown tab as the overview, like the page does", () => {
    expect(getQmPageHelp("/courses/7").title).toBe("Course overview");
    expect(getQmPageHelp("/courses/7", "?tab=bogus").title).toBe("Course overview");
  });

  it("tells the assessment builder apart from its variants screen", () => {
    expect(getQmPageHelp("/courses/7/assessments/9").title).toBe("Assessment builder");
    expect(getQmPageHelp("/courses/7/assessments/9/variants").title).toBe("Assessment variants");
  });
});
