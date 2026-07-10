import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseListView } from "../course-list-view";

type Course = { id: number; title: string; code: string; term: string; year: number; published: boolean };

const COURSES: Course[] = [
  { id: 1, title: "Algorithms", code: "COSC 320", term: "W1", year: 2026, published: true },
  { id: 2, title: "Databases", code: "COSC 304", term: "W2", year: 2026, published: false },
  { id: 3, title: "Old Systems", code: "COSC 121", term: "W1", year: 2025, published: true },
];

function renderList(props: Partial<React.ComponentProps<typeof CourseListView<Course>>> = {}) {
  return render(
    <CourseListView<Course>
      courses={COURSES}
      getKey={(c) => c.id}
      getTermInfo={(c) => ({ term: c.term, year: c.year })}
      getSearchText={(c) => `${c.title} ${c.code}`}
      renderCard={(c) => <div data-testid="card">{c.title}</div>}
      emptyState={<div>No courses yet</div>}
      noResultsState={<div>No courses match</div>}
      {...props}
    />,
  );
}

describe("CourseListView", () => {
  it("groups courses by term with headings, most recent first", () => {
    renderList();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    // 3 distinct terms -> 3 sections, newest first.
    expect(headings).toEqual(["Winter Term 2 2026", "Winter Term 1 2026", "Winter Term 1 2025"]);
    expect(screen.getAllByTestId("card")).toHaveLength(3);
  });

  it("filters by search across title and code", () => {
    renderList();
    fireEvent.change(screen.getByLabelText("Search courses"), { target: { value: "algo" } });
    expect(screen.getByText("Algorithms")).toBeInTheDocument();
    expect(screen.queryByText("Databases")).not.toBeInTheDocument();
  });

  it("shows no-results state when search matches nothing", () => {
    renderList();
    fireEvent.change(screen.getByLabelText("Search courses"), { target: { value: "zzz" } });
    expect(screen.getByText("No courses match")).toBeInTheDocument();
  });

  it("applies matchesFilter before search (role filter)", () => {
    renderList({ matchesFilter: (c) => c.published });
    expect(screen.getAllByTestId("card")).toHaveLength(2);
    expect(screen.queryByText("Databases")).not.toBeInTheDocument();
  });

  it("renders the empty state and no toolbar when there are zero courses", () => {
    renderList({ courses: [] });
    expect(screen.getByText("No courses yet")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search courses")).not.toBeInTheDocument();
  });

  it("renders a single term without a heading", () => {
    renderList({ courses: [COURSES[0]] });
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });

  it("renders a custom filters slot", () => {
    renderList({ filters: <button>Status</button> });
    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
  });
});
