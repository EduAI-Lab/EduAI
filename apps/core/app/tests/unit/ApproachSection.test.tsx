import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApproachSection } from "~/components/approach-section";

describe("ApproachSection — rendering", () => {
  it("renders the section heading", () => {
    render(<ApproachSection />);
    expect(screen.getByRole("heading", { name: "What makes EduAI different" })).toBeInTheDocument();
  });

  it("renders each differentiator pillar", () => {
    render(<ApproachSection />);
    expect(screen.getByText("Answers grounded in your course")).toBeInTheDocument();
    expect(screen.getByText("Your coursework stays on campus")).toBeInTheDocument();
    expect(screen.getByText("One account across every tool")).toBeInTheDocument();
    expect(screen.getByText("Built for how different people study")).toBeInTheDocument();
  });

  it("exposes the #approach anchor the header links to", () => {
    const { container } = render(<ApproachSection />);
    expect(container.querySelector("#approach")).toBeInTheDocument();
  });
});
