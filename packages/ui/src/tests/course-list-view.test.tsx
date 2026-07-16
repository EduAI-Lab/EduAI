import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CourseListView,
  buildStatusFilterGroup,
  buildTermFilterGroup,
  buildDepartmentFilterGroup,
} from "../course-list-view";

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts the current term first, even though a later term is chronologically newer", () => {
    // Today (mocked) is Oct 2026, inside the W1/2026 course's window — that
    // group reads "Current" and leads the list, ahead of the chronologically
    // newer W2/2026 ("Upcoming"); the earlier W1/2025 group is "Previous".
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));

    renderList();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    // Current term leads; the rest keep their normal most-recent-first order.
    expect(headings).toEqual(["2026W1", "2026W2", "2025W1"]);
    expect(screen.getAllByTestId("card")).toHaveLength(3);
    // "Current term" reflects real calendar date, not just the newest group.
    expect(screen.getByText(/Current term · 1 course/)).toBeInTheDocument();
    expect(screen.getByText(/Upcoming term · 1 course/)).toBeInTheDocument();
    expect(screen.getByText(/Previous term · 1 course/)).toBeInTheDocument();
  });

  it("labels every group 'Previous term' when today is after the newest course's term", () => {
    // Regression: today being past the newest course's term must not make that
    // group read as "Current term" just because it's the most recent one added
    // (the reported bug — July, real UBC term S2, was showing "Currently W2").
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2028-01-15T00:00:00Z")); // years past every course above
    renderList();
    expect(screen.queryByText(/Current term ·/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Previous term ·/)).toHaveLength(3);
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

  it("always renders the term heading + separator, even for a single term", () => {
    renderList({ courses: [COURSES[0]] });
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });

  it("renders a custom filters slot", () => {
    renderList({ filters: <button>Status</button> });
    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
  });

  it("renders a filter dropdown per active group, using its label as trigger", () => {
    renderList({
      filterGroups: [buildStatusFilterGroup<Course>((c) => c.published)],
    });
    // Mixed published/draft across COURSES -> control shows its label placeholder.
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("hides a group whose courses hold a single distinct value", () => {
    // All published -> Status control suppressed (nothing to choose).
    renderList({
      courses: COURSES.filter((c) => c.published),
      filterGroups: [buildStatusFilterGroup<Course>((c) => c.published)],
    });
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("hides a group when no course carries a value for it", () => {
    renderList({
      filterGroups: [buildDepartmentFilterGroup<Course>(() => null)],
    });
    expect(screen.queryByText("Department")).not.toBeInTheDocument();
  });
});

describe("course filter builders", () => {
  type C = { term: string; year: number; published: boolean; dept: string | null };
  const c = (over: Partial<C> = {}): C => ({
    term: "W1",
    year: 2026,
    published: true,
    dept: "COSC",
    ...over,
  });

  it("buildStatusFilterGroup maps published state to canonical values", () => {
    const g = buildStatusFilterGroup<C>((x) => x.published);
    expect(g.getValue(c({ published: true }))).toBe("published");
    expect(g.getValue(c({ published: false }))).toBe("draft");
    expect(g.options?.map((o) => o.value)).toEqual(["published", "draft"]);
  });

  it("buildTermFilterGroup encodes term+year and labels it compactly", () => {
    const g = buildTermFilterGroup<C>((x) => ({ term: x.term, year: x.year }));
    expect(g.getValue(c({ term: "W2", year: 2026 }))).toBe("W2::2026");
    expect(g.optionLabel?.("W2::2026")).toBe("2026W2");
    // More recent terms sort first (negated key).
    expect(g.optionSortKey?.("W2::2026")).toBeLessThan(g.optionSortKey?.("W1::2025") as number);
  });

  it("buildTermFilterGroup yields no value when term/year missing", () => {
    const g = buildTermFilterGroup<C>((x) => ({ term: x.term, year: x.year }));
    expect(g.getValue({ term: "", year: 2026, published: true, dept: null })).toBeNull();
  });

  it("buildDepartmentFilterGroup reads the department and supports a label map", () => {
    const g = buildDepartmentFilterGroup<C>((x) => x.dept, {
      optionLabel: (code) => (code === "COSC" ? "Computer Science" : code),
    });
    expect(g.getValue(c({ dept: "COSC" }))).toBe("COSC");
    expect(g.getValue(c({ dept: null }))).toBeNull();
    expect(g.optionLabel?.("COSC")).toBe("Computer Science");
  });
});
