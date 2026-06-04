import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamMemberCard } from "~/components/team-member-card";
import type { TeamMember } from "~/routes/team";

const member: TeamMember = {
  id: 1,
  name: "Ada Lovelace",
  image: "/public/images/ada.png",
  biography: "First programmer.",
  contribution: "Analytical Engine notes.",
  techStack: ["Math", "Logic"],
  codeSnippet: "console.log('hi')",
};

describe("TeamMemberCard — rendering", () => {
  it("renders the member's name", () => {
    render(<TeamMemberCard member={member} index={0} />);
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  });

  it("renders the biography and contribution", () => {
    render(<TeamMemberCard member={member} index={0} />);
    expect(screen.getByText("First programmer.")).toBeInTheDocument();
    expect(screen.getByText("Analytical Engine notes.")).toBeInTheDocument();
  });

  it("renders each tech stack item", () => {
    render(<TeamMemberCard member={member} index={0} />);
    expect(screen.getByText("Math")).toBeInTheDocument();
    expect(screen.getByText("Logic")).toBeInTheDocument();
  });

  it("strips /public from the image src", () => {
    render(<TeamMemberCard member={member} index={0} />);
    expect(screen.getByAltText("Ada Lovelace")).toHaveAttribute("src", "/images/ada.png");
  });
});

describe("TeamMemberCard — missing data", () => {
  it("renders without throwing when the tech stack is empty", () => {
    render(<TeamMemberCard member={{ ...member, techStack: [] }} index={0} />);
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  });
});
