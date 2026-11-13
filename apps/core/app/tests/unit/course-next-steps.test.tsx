import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { courseSetupSteps } from "~/components/courses/course-instructor-overview";
import { CourseNextSteps, type CourseNextStep } from "~/components/courses/course-next-steps";

const COLLAPSED_KEY = "eduai.course.nextStepsCollapsed";

const material = (status: string) => ({ status });

describe("courseSetupSteps", () => {
  it("has nothing done on an empty, unpublished course", () => {
    const steps = courseSetupSteps({
      materials: [],
      isPublished: false,
      canPublish: true,
      studentCount: 0,
    });
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["upload", false],
      ["ready", false],
      ["publish", false],
      ["students", false],
    ]);
    expect(steps[0].detail).toMatch(/^Upload lecture notes/);
    expect(steps[1].detail).toBe("Files are processed for the AI after you upload them.");
    expect(steps[2].detail).toMatch(/Publish course button under Course details/);
    expect(steps[3].detail).toMatch(/Join links only work once the course is published/);
    expect(steps[0].href).toBe("?tab=materials");
    expect(steps[1].href).toBe("?tab=materials");
    expect(steps[2].href).toBeUndefined();
    expect(steps[3]).toMatchObject({ label: "Add students", href: "?tab=enrollments" });
  });

  it("lets the publish step open the publish confirm only for someone who can publish", () => {
    const onPublish = vi.fn();
    const base = { materials: [], isPublished: false, studentCount: 0, onPublish };
    expect(courseSetupSteps({ ...base, canPublish: true })[2].onSelect).toBe(onPublish);
    expect(courseSetupSteps({ ...base, canPublish: false })[2].onSelect).toBeUndefined();
  });

  it("marks Add students done once a student is enrolled", () => {
    const steps = courseSetupSteps({
      materials: [],
      isPublished: true,
      canPublish: true,
      studentCount: 2,
    });
    expect(steps[3]).toMatchObject({ done: true, detail: "2 students enrolled." });
  });

  it("is not ready while a file is still processing, and counts failures", () => {
    const steps = courseSetupSteps({
      materials: [material("READY"), material("PROCESSING"), material("FAILED")],
      isPublished: false,
      canPublish: false,
      studentCount: 0,
    });
    expect(steps[0]).toMatchObject({ done: true, detail: expect.stringMatching(/^3 files added/) });
    expect(steps[1]).toMatchObject({
      done: false,
      detail: "1 of 3 ready for chat, 1 still processing, 1 failed (open Materials to retry).",
    });
    expect(steps[2].detail).toMatch(/Only an administrator can publish it/);
  });

  it("is ready once at least one file is ready and none is processing", () => {
    const steps = courseSetupSteps({
      materials: [material("READY")],
      isPublished: true,
      canPublish: true,
      studentCount: 1,
    });
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps[0].detail).toMatch(/^1 file added/);
    expect(steps[1].detail).toBe("1 of 1 ready for chat.");
    expect(steps[2].detail).toBe("Students can see this course and chat about it.");
    expect(steps[3].detail).toBe("1 student enrolled.");
  });

  it("is not ready when every file failed", () => {
    const [, ready] = courseSetupSteps({
      materials: [material("FAILED")],
      isPublished: false,
      canPublish: true,
      studentCount: 0,
    });
    expect(ready.done).toBe(false);
  });
});

const STEPS: CourseNextStep[] = [
  { key: "upload", label: "Add materials", done: true, detail: "1 file added.", href: "?a" },
  { key: "ready", label: "Materials ready", done: false, detail: "0 of 1 ready.", href: "?b" },
  { key: "publish", label: "Publish course", done: false, detail: "Not yet." },
];
const DONE = STEPS.map((s) => ({ ...s, done: true }));

function renderSteps(steps: CourseNextStep[]) {
  return render(
    <MemoryRouter>
      <CourseNextSteps steps={steps} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("CourseNextSteps", () => {
  it("shows the steps open, linking only the unfinished ones that have a destination", () => {
    renderSteps(STEPS);
    expect(screen.getByText("Next steps")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Materials ready/ })).toHaveAttribute("href", "/?b");
    expect(screen.queryByRole("link", { name: /Add materials/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Publish course/ })).toBeNull();
  });

  it("runs a step's action in place instead of linking", () => {
    const onSelect = vi.fn();
    renderSteps([
      ...STEPS.slice(0, 2),
      { key: "publish", label: "Publish course", done: false, detail: "Not yet.", onSelect },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Publish course/ }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: /Publish course/ })).toBeNull();
  });

  it("collapses to the next step and remembers the choice", () => {
    renderSteps(STEPS);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByText("Next: Materials ready")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe("0");
  });

  it("tucks a finished setup away unless the instructor chose otherwise", () => {
    const { unmount } = renderSteps(DONE);
    expect(screen.getByText("Course is set up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show" })).toHaveAttribute("aria-expanded", "false");
    unmount();

    window.localStorage.setItem(COLLAPSED_KEY, "0");
    renderSteps(DONE);
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true");
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderSteps(DONE);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});
