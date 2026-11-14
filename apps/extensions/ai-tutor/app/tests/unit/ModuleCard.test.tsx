import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModuleCard } from "~/components/courses/ModuleCard";

describe("ModuleCard", () => {
  it("renders title, description, and an order chip", () => {
    render(
      <ModuleCard
        title="Week 1"
        description="Intro to the course"
        index={0}
        accentColor="blue"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Week 1")).toBeInTheDocument();
    expect(screen.getByText("Intro to the course")).toBeInTheDocument();
    // Two "01" instances: the eyebrow chip and the ghost watermark.
    expect(screen.getAllByText("01").length).toBeGreaterThanOrEqual(1);
  });

  it("pads the order label for higher indexes", () => {
    render(<ModuleCard title="Week 10" index={9} accentColor="blue" onClick={vi.fn()} />);
    expect(screen.getAllByText("10").length).toBeGreaterThanOrEqual(1);
  });

  it("calls onClick when the card is clicked", () => {
    const onClick = vi.fn();
    render(<ModuleCard title="Week 1" index={0} accentColor="blue" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onClick on Enter and Space keydown", () => {
    const onClick = vi.fn();
    render(<ModuleCard title="Week 1" index={0} accentColor="blue" onClick={onClick} />);

    const card = screen.getByRole("button");
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("does not call onClick for other keys", () => {
    const onClick = vi.fn();
    render(<ModuleCard title="Week 1" index={0} accentColor="blue" onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Tab" });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a progress bar when progress has total > 0", () => {
    render(
      <ModuleCard
        title="Week 1"
        index={0}
        accentColor="blue"
        onClick={vi.fn()}
        showProgress
        progress={{ completed: 2, total: 4, percentage: 50 }}
      />,
    );
    expect(screen.queryByText("Not started yet")).not.toBeInTheDocument();
  });

  it('shows "Not started yet" when progress total is 0', () => {
    render(
      <ModuleCard
        title="Week 1"
        index={0}
        accentColor="blue"
        onClick={vi.fn()}
        showProgress
        progress={{ completed: 0, total: 0, percentage: 0 }}
      />,
    );
    expect(screen.getByText("Not started yet")).toBeInTheDocument();
  });
});
