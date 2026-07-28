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

  // Opening the Radix menu in jsdom is slow (portal + focus scope), so these
  // assert as much as possible per open rather than one case per test.
  describe("server-driven search (#1143)", () => {
    // Radix opens on pointerdown, which jsdom has no PointerEvent for, so drive
    // the trigger's keyboard path instead.
    const openMenu = () =>
      fireEvent.keyDown(screen.getByLabelText("Switch course"), { key: "Enter" });

    it("adds a search box only when onQueryChange is supplied, and forwards keystrokes without filtering locally", () => {
      const onQueryChange = vi.fn();
      const { unmount } = render(
        <CourseSwitcher courses={COURSES} currentId={2} onSelect={() => {}} />,
      );
      openMenu();
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
      unmount();

      render(
        <CourseSwitcher
          courses={COURSES}
          currentId={2}
          onSelect={() => {}}
          onQueryChange={onQueryChange}
        />,
      );
      openMenu();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

      expect(onQueryChange).toHaveBeenCalledWith("zzz");
      // The host already narrowed these server-side; filtering again here would
      // drop rows the server matched on a field the label doesn't show.
      expect(screen.getByText("COSC 111")).toBeInTheDocument();
      // MATH 200 is also the trigger label, so it legitimately appears twice.
      expect(screen.getAllByText("MATH 200").length).toBeGreaterThan(1);
    });

    it("shows the empty label when a search returns nothing", () => {
      render(
        <CourseSwitcher courses={[]} currentId={2} onSelect={() => {}} onQueryChange={() => {}} />,
      );
      openMenu();
      expect(screen.getByText("No courses found")).toBeInTheDocument();
    });
  });
});
