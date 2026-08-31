import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResearchSection } from "~/components/research-section";

describe("ResearchSection — rendering", () => {
  it("renders the section heading", () => {
    render(<ResearchSection />);
    expect(screen.getByRole("heading", { name: "Research at the lab" })).toBeInTheDocument();
  });

  it("renders each research thread", () => {
    render(<ResearchSection />);
    expect(screen.getByText("Grounded retrieval")).toBeInTheDocument();
    expect(screen.getByText("Model routing for less energy")).toBeInTheDocument();
    expect(screen.getByText("Assistive Mode for ADHD")).toBeInTheDocument();
    expect(screen.getByText("Tutors that check their own work")).toBeInTheDocument();
  });

  it("exposes the #research anchor the header links to", () => {
    const { container } = render(<ResearchSection />);
    expect(container.querySelector("#research")).toBeInTheDocument();
  });
});
