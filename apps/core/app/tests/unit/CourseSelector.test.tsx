import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CourseSelector } from "~/components/course-selector";
import type { Course } from "~/components/course-selector";

const sampleCourses: Course[] = [
  { id: "c1", code: "CS101", name: "Intro to CS" },
  { id: "c2", code: "MATH200", name: "Calculus" },
];

describe("CourseSelector — rendering", () => {
  it("renders the course selection heading", () => {
    render(
      <CourseSelector courses={sampleCourses} selectedCourseId={null} onCourseSelect={vi.fn()} />
    );
    expect(screen.getByText("Course Selection")).toBeInTheDocument();
  });

  it("shows the prompt to enable RAG when no course is selected", () => {
    render(
      <CourseSelector courses={sampleCourses} selectedCourseId={null} onCourseSelect={vi.fn()} />
    );
    expect(screen.getByText(/enable RAG chat/)).toBeInTheDocument();
  });

  it("shows the active-course message when a course is selected", () => {
    render(
      <CourseSelector courses={sampleCourses} selectedCourseId="c1" onCourseSelect={vi.fn()} />
    );
    expect(screen.getByText(/search through materials from the selected course/)).toBeInTheDocument();
  });
});

describe("CourseSelector — missing data", () => {
  it("renders without throwing when there are no courses", () => {
    render(<CourseSelector courses={[]} selectedCourseId={null} onCourseSelect={vi.fn()} />);
    expect(screen.getByText("Course Selection")).toBeInTheDocument();
  });
});
