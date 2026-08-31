/**
 * Unit tests for `CourseNoAccessAlert` (#1546): the per-course access denial
 * banner and its "course selection" escape hatch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { CourseNoAccessAlert } from "@/components/rbac/CourseNoAccessAlert";

afterEach(() => cleanup());

describe("CourseNoAccessAlert", () => {
  it("renders the access-denied message as an alert", () => {
    render(<CourseNoAccessAlert onGoToCourses={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/do not have access to this course/i);
  });

  it("calls onGoToCourses when the link is clicked", () => {
    const onGoToCourses = vi.fn();
    render(<CourseNoAccessAlert onGoToCourses={onGoToCourses} />);
    fireEvent.click(screen.getByText("course selection"));
    expect(onGoToCourses).toHaveBeenCalledTimes(1);
  });
});
