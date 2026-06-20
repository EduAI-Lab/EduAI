import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectGoals } from "~/components/project-goals";

describe("ProjectGoals — rendering", () => {
  it("renders the section heading", () => {
    render(<ProjectGoals />);
    expect(screen.getByRole("heading", { name: "Project goals" })).toBeInTheDocument();
  });

  it("renders the individual goal cards", () => {
    render(<ProjectGoals />);
    expect(screen.getByText("Cognitive AI Models")).toBeInTheDocument();
    expect(screen.getByText("Personalized Learning")).toBeInTheDocument();
    expect(screen.getByText("Global Access")).toBeInTheDocument();
  });
});
