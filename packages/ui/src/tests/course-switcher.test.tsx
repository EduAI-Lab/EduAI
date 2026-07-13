import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseSwitcher } from "../course-switcher";

const COURSES = [
  { id: 1, label: "COSC 111", sublabel: "Intro to CS" },
  { id: 2, label: "MATH 200", sublabel: "Calculus" },
];

describe("CourseSwitcher", () => {
  it("shows the current course label", () => {
    render(
      <CourseSwitcher courses={COURSES} currentId={2} onSelect={() => {}} />,
    );
    expect(screen.getByText("MATH 200")).toBeInTheDocument();
    // The dropdown arrow is its own control, separate from the label.
    expect(screen.getByLabelText("Switch course")).toBeInTheDocument();
  });

  it("falls back to a placeholder when the current id is unknown", () => {
    render(
      <CourseSwitcher courses={COURSES} currentId={999} onSelect={() => {}} />,
    );
    expect(screen.getByText("Select course")).toBeInTheDocument();
  });

  it("accepts string ids", () => {
    render(
      <CourseSwitcher
        courses={[{ id: "abc", label: "ENGL 100" }]}
        currentId="abc"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("ENGL 100")).toBeInTheDocument();
  });

  it("renders the label as a clickable control that opens the current course", () => {
    const onOpenCurrent = vi.fn();
    render(
      <CourseSwitcher
        courses={COURSES}
        currentId={2}
        onSelect={() => {}}
        onOpenCurrent={onOpenCurrent}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "MATH 200" }));
    expect(onOpenCurrent).toHaveBeenCalledTimes(1);
  });
});
