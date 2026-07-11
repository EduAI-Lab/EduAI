import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseSwitcher } from "../course-switcher";

const COURSES = [
  { id: 1, label: "COSC 111", sublabel: "Intro to CS" },
  { id: 2, label: "MATH 200", sublabel: "Calculus" },
];

describe("CourseSwitcher", () => {
  it("shows the current course label on the trigger", () => {
    render(
      <CourseSwitcher courses={COURSES} currentId={2} onSelect={() => {}} />,
    );
    const trigger = screen.getByLabelText("Switch course");
    expect(trigger).toHaveTextContent("MATH 200");
  });

  it("falls back to a placeholder when the current id is unknown", () => {
    render(
      <CourseSwitcher courses={COURSES} currentId={999} onSelect={() => {}} />,
    );
    expect(screen.getByLabelText("Switch course")).toHaveTextContent("Select course");
  });

  it("accepts string ids", () => {
    render(
      <CourseSwitcher
        courses={[{ id: "abc", label: "ENGL 100" }]}
        currentId="abc"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByLabelText("Switch course")).toHaveTextContent("ENGL 100");
  });
});
