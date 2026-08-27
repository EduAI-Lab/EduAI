import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeLevelChips } from "~/components/chat/knowledge-level-chips";

describe("KnowledgeLevelChips", () => {
  it("renders a chip for every knowledge level", () => {
    render(<KnowledgeLevelChips value={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "New to this" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Some idea" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confident" })).toBeInTheDocument();
  });

  it("marks the selected level as pressed", () => {
    render(<KnowledgeLevelChips value="intermediate" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Some idea" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "New to this" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onSelect with the level's value when clicked", () => {
    const onSelect = vi.fn();
    render(<KnowledgeLevelChips value={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Confident" }));
    expect(onSelect).toHaveBeenCalledWith("advanced");
  });

  it("applies an additional className when provided", () => {
    const { container } = render(
      <KnowledgeLevelChips value={null} onSelect={vi.fn()} className="extra-class" />,
    );
    expect(container.querySelector(".extra-class")).toBeInTheDocument();
  });
});
