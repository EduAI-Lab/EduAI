import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { HelpView } from "~/components/help/HelpView";

describe("HelpView", () => {
  it("renders the shared topics for every role and no role badge when role is omitted", () => {
    render(
      <MemoryRouter>
        <HelpView />
      </MemoryRouter>,
    );
    expect(screen.getByText("Help & guide")).toBeInTheDocument();
    expect(screen.getAllByText("Using the AI tutor").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finding your way around").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Command palette & suite tools").length).toBeGreaterThan(0);
    expect(screen.queryByText("For instructors, TAs, and unit admins")).not.toBeInTheDocument();
    expect(screen.queryByText("For admins")).not.toBeInTheDocument();
  });

  it("shows staff topics but not admin topics for an instructor", () => {
    render(
      <MemoryRouter>
        <HelpView role="INSTRUCTOR" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("For instructors, TAs, and unit admins").length).toBeGreaterThan(0);
    expect(screen.queryByText("For admins")).not.toBeInTheDocument();
    expect(screen.getByText("Instructor")).toBeInTheDocument();
  });

  it("shows the admin topic and role badge for an admin", () => {
    render(
      <MemoryRouter>
        <HelpView role="ADMIN" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("For instructors, TAs, and unit admins").length).toBeGreaterThan(0);
    expect(screen.getAllByText("For admins").length).toBeGreaterThan(0);
    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });

  it("hides staff/admin topics for a student", () => {
    render(
      <MemoryRouter>
        <HelpView role="STUDENT" />
      </MemoryRouter>,
    );
    expect(screen.queryByText("For instructors, TAs, and unit admins")).not.toBeInTheDocument();
    expect(screen.queryByText("For admins")).not.toBeInTheDocument();
    expect(screen.getByText("Student")).toBeInTheDocument();
  });
});
