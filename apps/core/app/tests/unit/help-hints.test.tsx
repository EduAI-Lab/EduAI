/**
 * #1053: every Core HelpHint deep-links to a /help section that exists for the
 * people who can see that hint, so the "Read more" link never lands on nothing.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  useTour: () => ({ startTour: vi.fn() }),
}));

import { CORE_HELP } from "~/components/help/help-hints";
import { HelpView } from "~/components/help/help-view";

type Viewer = { role: string; isTA?: boolean; isCourseInstructor?: boolean };

const INSTRUCTOR: Viewer = { role: "INSTRUCTOR" };
const TA: Viewer = { role: "STUDENT", isTA: true };
const COURSE_INSTRUCTOR: Viewer = { role: "STUDENT", isCourseInstructor: true };
const STUDENT: Viewer = { role: "STUDENT" };
const ADMIN: Viewer = { role: "ADMIN" };

/** Who sees each hint, from where it is placed in the UI. */
const VIEWERS = {
  // Manager and TA course views, Materials tab.
  materialStates: [INSTRUCTOR, COURSE_INSTRUCTOR, TA, ADMIN],
  // Manager course view: Published field and the material visibility dialog.
  coursePublishing: [INSTRUCTOR, COURSE_INSTRUCTOR, ADMIN],
  materialVisibility: [INSTRUCTOR, COURSE_INSTRUCTOR, ADMIN],
  // Course Chat, course assistant and admin chatbot welcome screens.
  chatScope: [STUDENT, TA, INSTRUCTOR, ADMIN],
  // Admin-only pages.
  aiModels: [ADMIN],
  aiProviders: [ADMIN],
  platformPolicies: [ADMIN],
} satisfies Record<keyof typeof CORE_HELP, Viewer[]>;

function sectionIds(viewer: Viewer) {
  const { container, unmount } = render(
    <MemoryRouter>
      <HelpView {...viewer} />
    </MemoryRouter>,
  );
  const ids = new Set([...container.querySelectorAll("section[id]")].map((el) => el.id));
  unmount();
  return ids;
}

describe("CORE_HELP", () => {
  it.each(Object.entries(CORE_HELP))("%s has complete copy", (_key, hint) => {
    expect(hint.title.trim()).not.toBe("");
    expect(hint.summary.trim()).not.toBe("");
    expect(hint.details.length).toBeGreaterThan(hint.summary.length);
    expect(hint.href).toMatch(/^\/help#[a-z0-9-]+$/);
  });

  it.each(Object.entries(VIEWERS))(
    "%s links to a /help section every viewer of it can see",
    (key, viewers) => {
      const id = CORE_HELP[key as keyof typeof CORE_HELP].href.split("#")[1];
      for (const viewer of viewers) {
        expect(sectionIds(viewer), `${JSON.stringify(viewer)} is missing #${id}`).toContain(id);
      }
    },
  );
});
