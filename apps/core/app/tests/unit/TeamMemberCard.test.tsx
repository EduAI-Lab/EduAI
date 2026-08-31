import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TeamMemberCard } from "~/components/team-member-card";
import type { TeamMember } from "~/config/team";

const member: TeamMember = {
  id: 1,
  role: "professor",
  name: "Ada Lovelace",
  position: "Professor",
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

  it("shows the position tag and a clickable View profile affordance", () => {
    render(<TeamMemberCard member={member} />);
    expect(screen.getByText("Professor")).toBeInTheDocument();
    expect(screen.getByText("View profile")).toBeInTheDocument();
  });

  it("keeps the tech stack off the grid face", () => {
    render(<TeamMemberCard member={member} />);
    expect(screen.queryByText("Math")).not.toBeInTheDocument();
    expect(screen.queryByText("Analytical Engine notes.")).not.toBeInTheDocument();
  });

  it("strips /public from the image src", () => {
    render(<TeamMemberCard member={member} />);
    expect(screen.getByAltText("Ada Lovelace")).toHaveAttribute("src", "/images/ada.png");
  });

  it("falls back to the shared anonymous portrait when no image is set", () => {
    render(<TeamMemberCard member={{ ...member, name: "Dr. Grace Hopper", image: "" }} />);
    expect(screen.getByAltText("Dr. Grace Hopper")).toHaveAttribute("src", "/anonymous.jpg");
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
