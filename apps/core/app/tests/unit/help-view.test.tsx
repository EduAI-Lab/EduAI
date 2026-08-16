/**
 * In-app help guide (#764). The interesting behavior is the role-based topic
 * filter: role-less topics always show, STAFF topics show for
 * ADMIN/UNIT_ADMIN/INSTRUCTOR, and ADMINS topics only for ADMIN/UNIT_ADMIN.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import { HelpView } from "~/components/help/help-view";

function renderHelp(role?: string) {
  return render(
    <MemoryRouter>
      <HelpView role={role} />
    </MemoryRouter>,
  );
}

describe("HelpView", () => {
  it("shows role-less topics and hides staff/admin topics when no role is given", () => {
    renderHelp(undefined);

    expect(screen.getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Courses" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI chatbot" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Course materials" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("shows the STAFF-only Course materials topic for an INSTRUCTOR but not Administration", () => {
    renderHelp("INSTRUCTOR");

    expect(screen.getByRole("heading", { name: "Course materials" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("shows both staff and admin topics for ADMIN", () => {
    renderHelp("ADMIN");

    expect(screen.getByRole("heading", { name: "Course materials" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Administration" })).toBeInTheDocument();
  });

  it("hides staff/admin topics for a STUDENT", () => {
    renderHelp("STUDENT");

    expect(screen.queryByRole("heading", { name: "Course materials" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("renders the jump-link rail with an anchor per visible topic", () => {
    renderHelp("ADMIN");

    const nav = screen.getByRole("navigation", { name: "Guide sections" });
    expect(nav.querySelectorAll("a")).toHaveLength(6);
    expect(screen.getByRole("link", { name: /Administration/ })).toHaveAttribute(
      "href",
      "#administration",
    );
  });

  it("renders the replay tour link pointing at the dashboard tour query param", () => {
    renderHelp("STUDENT");

    const replayLink = screen.getByRole("link", { name: /Replay guided tour/ });
    expect(replayLink).toHaveAttribute("href", "/dashboard?tour=1");
  });

  it("renders nested links inside topic bodies, e.g. the Courses link", () => {
    renderHelp("STUDENT");

    const coursesLinks = screen.getAllByRole("link", { name: "Courses" });
    const bodyLink = coursesLinks.find((el) => el.getAttribute("href") === "/courses");
    expect(bodyLink).toBeDefined();
  });
});
