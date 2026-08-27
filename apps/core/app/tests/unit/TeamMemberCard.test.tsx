import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TeamMemberCard } from "~/components/team-member-card";
import type { TeamMember } from "~/config/team";

const member: TeamMember = {
  id: 1,
  role: "professor",
  name: "Ada Lovelace",
  title: "Analytical Engine Lead",
  image: "/public/images/ada.png",
  biography: "First programmer.",
  contribution: "Analytical Engine notes.",
  techStack: ["Math", "Logic", "Poetry"],
  codeSnippet: "console.log('hi')",
};

describe("TeamMemberCard — grid face", () => {
  it("renders the member's name and title", () => {
    render(<TeamMemberCard member={member} />);
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("Analytical Engine Lead")).toBeInTheDocument();
  });

  it("renders the contribution as the focus line", () => {
    render(<TeamMemberCard member={member} />);
    expect(screen.getByText("Analytical Engine notes.")).toBeInTheDocument();
  });

  it("shows the first tech as the specialty chip and the rest as badges", () => {
    render(<TeamMemberCard member={member} />);
    expect(screen.getByText("Math")).toBeInTheDocument();
    expect(screen.getByText("Logic")).toBeInTheDocument();
    expect(screen.getByText("Poetry")).toBeInTheDocument();
  });

  it("collapses extra tech beyond three badges into a +N chip", () => {
    render(
      <TeamMemberCard
        member={{ ...member, techStack: ["A", "B", "C", "D", "E", "F"] }}
      />,
    );
    // "A" is the specialty chip; B/C/D are badges; E/F collapse into +2.
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("strips /public from the image src", () => {
    render(<TeamMemberCard member={member} />);
    expect(screen.getByAltText("Ada Lovelace")).toHaveAttribute("src", "/images/ada.png");
  });

  it("falls back to initials when no image is set", () => {
    render(<TeamMemberCard member={{ ...member, name: "Dr. Grace Hopper", image: "" }} />);
    expect(screen.queryByAltText("Dr. Grace Hopper")).not.toBeInTheDocument();
    expect(screen.getAllByText("GH").length).toBeGreaterThan(0);
  });
});

describe("TeamMemberCard — dialog", () => {
  it("reveals the biography and signature line after opening", () => {
    render(<TeamMemberCard member={member} />);
    expect(screen.queryByText("First programmer.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }));

    expect(screen.getByText("First programmer.")).toBeInTheDocument();
    expect(screen.getByText("console.log('hi')")).toBeInTheDocument();
  });
});

describe("TeamMemberCard — missing data", () => {
  it("renders without throwing when the tech stack is empty", () => {
    render(<TeamMemberCard member={{ ...member, techStack: [] }} />);
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  });
});
