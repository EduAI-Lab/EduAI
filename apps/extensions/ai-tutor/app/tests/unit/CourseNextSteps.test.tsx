import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { CourseNextSteps, type CourseNextStep } from "~/components/courses/CourseNextSteps";

const KEY = "eduai.aiTutor.course.nextStepsCollapsed";

const todo: CourseNextStep[] = [
  { key: "a", label: "Add a module", done: true, detail: "Add one." },
  { key: "b", label: "Publish the course", done: false, detail: "Publish it." },
];
const allDone = todo.map((s) => ({ ...s, done: true }));

function renderSteps(steps: CourseNextStep[]) {
  return render(
    <MemoryRouter>
      <CourseNextSteps steps={steps} />
    </MemoryRouter>,
  );
}

describe("CourseNextSteps", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("collapses on Hide, shows the next step, and remembers the choice", () => {
    renderSteps(todo);
    fireEvent.click(screen.getByRole("button", { name: /hide/i }));

    expect(screen.getByText("Next: Publish the course")).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(window.localStorage.getItem(KEY)).toBe("0");
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("tucks a finished setup away unless the instructor kept it open", () => {
    const { unmount } = renderSteps(allDone);
    expect(screen.getByText("Course is set up")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    unmount();

    window.localStorage.setItem(KEY, "0");
    renderSteps(allDone);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    renderSteps(allDone);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
