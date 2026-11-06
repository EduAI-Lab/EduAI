import {
  cleanup,
  renderHook,
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  QmCourseGridCard,
  QmCourseListRow,
  QmCourseStatusPill,
  qmCourseLinks,
  useQmCourseView,
} from "@/components/courses/QmCourseCard";
import type { Course } from "@/types/question";

const course: Course = {
  id: 1,
  name: "Intro",
  code: "COSC 101",
  department: "COSC",
  term: "W1",
  year: 2026,
  isPublished: true,
  updatedAt: "2026-03-05T12:00:00Z",
};

afterEach(cleanup);

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("QmCourseGridCard", () => {
  beforeEach(() => localStorage.clear());

  it("links the title to the course and has no role=button", () => {
    wrap(<QmCourseGridCard course={course} links={qmCourseLinks(course, false)} />);
    expect(screen.getByRole("link", { name: "COSC 101 · Intro" })).toHaveAttribute(
      "href",
      "/courses/1",
    );
    expect(screen.queryByRole("button", { name: /^(?!COSC 101 actions)/ })).toBeNull();
  });

  it("lists section shortcuts, with Canvas only when linked", () => {
    const { unmount } = wrap(
      <QmCourseGridCard course={course} links={qmCourseLinks(course, false)} />,
    );
    const nav = screen.getByRole("navigation", { name: "COSC 101 sections" });
    expect(within(nav).getByRole("link", { name: "Questions" })).toHaveAttribute(
      "href",
      "/courses/1?tab=questions",
    );
    expect(within(nav).getByRole("link", { name: "Banks" })).toHaveAttribute(
      "href",
      "/courses/1?tab=banks",
    );
    expect(within(nav).getByRole("link", { name: "Assessments" })).toHaveAttribute(
      "href",
      "/courses/1?tab=assessments",
    );
    expect(within(nav).queryByRole("link", { name: "Canvas" })).toBeNull();
    unmount();
    wrap(<QmCourseGridCard course={course} links={qmCourseLinks(course, true)} />);
    expect(screen.getByRole("link", { name: "Canvas" })).toBeInTheDocument();
  });

  it("opens the actions menu and closes it on Escape", () => {
    wrap(<QmCourseGridCard course={course} links={[]} />);
    // Radix opens on pointerdown, not click.
    fireEvent.pointerDown(screen.getByRole("button", { name: "COSC 101 actions" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    expect(screen.getByRole("menuitem", { name: "Open course" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Questions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Assessments" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Open course" })).toBeNull();
  });

  it("shows the department on the banner only with showDepartment", () => {
    const { unmount } = wrap(<QmCourseGridCard course={course} links={[]} showDepartment />);
    expect(screen.getByText("COSC")).toBeInTheDocument();
    unmount();
    wrap(<QmCourseGridCard course={course} links={[]} />);
    expect(screen.queryByText("COSC")).toBeNull();
  });
});

describe("QmCourseStatusPill", () => {
  it("renders Published, Unpublished, or nothing", () => {
    const { rerender, container } = render(<QmCourseStatusPill isPublished />);
    expect(screen.getByText("Published")).toBeInTheDocument();
    rerender(<QmCourseStatusPill isPublished={false} />);
    expect(screen.getByText("Unpublished")).toBeInTheDocument();
    rerender(<QmCourseStatusPill isPublished={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("QmCourseListRow", () => {
  it("shows link, department and formatted date", () => {
    wrap(<QmCourseListRow course={course} />);
    expect(screen.getByRole("link", { name: "Intro" })).toHaveAttribute("href", "/courses/1");
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(
      screen.getByText(
        new Date(course.updatedAt!).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      ),
    ).toBeInTheDocument();
  });

  it("shows a dash without updatedAt", () => {
    wrap(<QmCourseListRow course={{ ...course, updatedAt: undefined, department: null }} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});

describe("useQmCourseView", () => {
  beforeEach(() => localStorage.clear());

  it("reads and writes localStorage", () => {
    localStorage.setItem("eduai.questionMaker.courseView", "list");
    const { result } = renderHook(() => useQmCourseView());
    expect(result.current[0]).toBe("list");
    act(() => result.current[1]("card"));
    expect(result.current[0]).toBe("card");
    expect(localStorage.getItem("eduai.questionMaker.courseView")).toBe("card");
  });
});
