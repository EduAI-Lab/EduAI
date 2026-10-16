/**
 * #1054: every AI Tutor HelpHint deep-links to a /help section that exists for
 * the roles who can see that hint, and the help page scrolls to that section
 * even when it only renders once the user's role has loaded.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { HelpView } from "~/components/help/HelpView";
import { AI_TUTOR_HELP } from "~/lib/help/help-hints";
import type { Role } from "~/lib/types";

const STAFF: Role[] = ["INSTRUCTOR", "TA", "UNIT_ADMIN", "ADMIN"];
const EVERYONE: Role[] = ["STUDENT", ...STAFF];

/** Who sees each hint, from where it is placed in the UI. */
const VIEWERS = {
  // Student lesson chat (staff can open it too, via preview).
  chatModes: EVERYONE,
  knowledgeLevel: EVERYONE,
  // Activity editor, course modules list and Submissions tab.
  authoringModes: STAFF,
  publishingHierarchy: STAFF,
  topicSync: STAFF,
  grading: STAFF,
} satisfies Record<keyof typeof AI_TUTOR_HELP, Role[]>;

function sectionIds(role: Role) {
  const { container, unmount } = render(
    <MemoryRouter>
      <HelpView role={role} />
    </MemoryRouter>,
  );
  const ids = new Set([...container.querySelectorAll("[id]")].map((el) => el.id));
  unmount();
  return ids;
}

afterEach(() => vi.restoreAllMocks());

describe("AI_TUTOR_HELP", () => {
  it.each(Object.entries(AI_TUTOR_HELP))("%s has complete copy", (_key, hint) => {
    expect(hint.title.trim()).not.toBe("");
    expect(hint.summary.trim()).not.toBe("");
    expect(hint.details.length).toBeGreaterThan(hint.summary.length);
    expect(hint.href).toMatch(/^\/help#[a-z0-9-]+$/);
  });

  it.each(Object.entries(VIEWERS))(
    "%s links to a /help section every viewer of it can see",
    (key, roles) => {
      const id = AI_TUTOR_HELP[key as keyof typeof AI_TUTOR_HELP].href.split("#")[1];
      for (const role of roles) {
        expect(sectionIds(role), `${role} is missing #${id}`).toContain(id);
      }
    },
  );
});

describe("HelpView hash deep links", () => {
  it("scrolls to the hashed section once it renders after the role loads", () => {
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      function (this: HTMLElement) {
        scrolled.push(this.id);
      },
    );

    const { rerender } = render(
      <MemoryRouter initialEntries={["/help#publishing"]}>
        <HelpView />
      </MemoryRouter>,
    );
    expect(scrolled).toEqual([]);

    rerender(
      <MemoryRouter initialEntries={["/help#publishing"]}>
        <HelpView role="INSTRUCTOR" />
      </MemoryRouter>,
    );
    expect(scrolled).toEqual(["publishing"]);
  });

  it("ignores an unknown hash", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={["/help#not-a-section"]}>
        <HelpView role="ADMIN" />
      </MemoryRouter>,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
