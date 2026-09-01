/**
 * Unit tests for the QM `CourseSwitcher` adapter (#1546): maps display courses to
 * the shared `@eduai/ui` switcher's option shape, seeds the active course when
 * missing from the list, and carries the active workspace tab across navigation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
const sublabelFn = vi.fn((c: any) => (c.term ? `term:${c.term}` : undefined));
let searchParamsValue = new URLSearchParams();
let pathnameValue = "/courses/1";
let displayCoursesValue: any[] = [];

vi.mock("react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: pathnameValue }),
  useSearchParams: () => [searchParamsValue],
}));

vi.mock("@/hooks/useDisplayCourses", () => ({
  useDisplayCourses: () => ({ displayCourses: displayCoursesValue }),
}));

vi.mock("@eduai/ui", () => ({
  CourseSwitcher: (props: any) => (
    <div data-testid="shared-switcher">
      <span data-testid="current-id">{props.currentId}</span>
      <span data-testid="option-count">{props.courses.length}</span>
      {props.courses.map((c: any) => (
        <button key={c.id} onClick={() => props.onSelect(c.id)}>
          {c.label}
          <span data-testid={`sublabel-${c.id}`}>{c.sublabel ?? ""}</span>
        </button>
      ))}
      <button onClick={props.onOpenCurrent}>open-current</button>
      <button onClick={props.onViewAll}>view-all</button>
    </div>
  ),
  courseSwitcherSublabel: (c: any) => sublabelFn(c),
}));

import { CourseSwitcher } from "@/components/layout/CourseSwitcher";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParamsValue = new URLSearchParams();
  pathnameValue = "/courses/1";
  displayCoursesValue = [];
});

describe("CourseSwitcher", () => {
  it("maps display courses to switcher options using code as the label", () => {
    displayCoursesValue = [{ id: 1, code: "CPSC 101", name: "Intro to CS" }];
    render(<CourseSwitcher courseId={1} />);

    expect(screen.getByTestId("option-count").textContent).toBe("1");
    expect(screen.getByText("CPSC 101")).toBeInTheDocument();
  });

  it("carries the shared term sublabel onto each option", () => {
    displayCoursesValue = [{ id: 1, code: "CPSC 101", name: "Intro to CS", term: "2026W1" }];
    render(<CourseSwitcher courseId={1} />);

    expect(sublabelFn).toHaveBeenCalledWith(displayCoursesValue[0]);
    expect(screen.getByTestId("sublabel-1").textContent).toBe("term:2026W1");
  });

  it("seeds the active course when missing from the loaded list", () => {
    displayCoursesValue = [{ id: 2, code: "MATH 200", name: "Calculus" }];
    render(<CourseSwitcher courseId={99} />);

    expect(screen.getByTestId("option-count").textContent).toBe("2");
    expect(screen.getByText("Course 99")).toBeInTheDocument();
  });

  it("navigates to the selected course preserving a safe tab param", () => {
    searchParamsValue = new URLSearchParams("tab=questions");
    displayCoursesValue = [{ id: 3, code: "BIOL 100", name: "Biology" }];
    render(<CourseSwitcher courseId={3} />);

    fireEvent.click(screen.getByText("BIOL 100"));
    expect(navigate).toHaveBeenCalledWith("/courses/3?tab=questions");
  });

  it("falls back to the overview tab for an unrecognized tab param", () => {
    searchParamsValue = new URLSearchParams("tab=bogus");
    displayCoursesValue = [{ id: 4, code: "CHEM 100", name: "Chemistry" }];
    render(<CourseSwitcher courseId={4} />);

    fireEvent.click(screen.getByText("CHEM 100"));
    expect(navigate).toHaveBeenCalledWith("/courses/4?tab=overview");
  });

  it("onOpenCurrent and onViewAll navigate to expected routes", () => {
    displayCoursesValue = [{ id: 5, code: "ENGL 100", name: "English" }];
    render(<CourseSwitcher courseId={5} />);

    fireEvent.click(screen.getByText("open-current"));
    expect(navigate).toHaveBeenCalledWith("/courses/5?tab=overview");

    fireEvent.click(screen.getByText("view-all"));
    expect(navigate).toHaveBeenCalledWith("/courses");
  });

  it.each([
    ["/courses/3/banks/9", "banks"],
    ["/courses/3/assessments/4", "assessments"],
    ["/courses/3/questions/7", "questions"],
  ])("infers the workspace tab from the deep route %s", (pathname, tab) => {
    pathnameValue = pathname;
    displayCoursesValue = [{ id: 3, code: "BIOL 100", name: "Biology" }];
    render(<CourseSwitcher courseId={3} />);

    fireEvent.click(screen.getByText("open-current"));
    expect(navigate).toHaveBeenCalledWith(`/courses/3?tab=${tab}`);
  });

  it("prefers a safe tab param over the inferred deep route", () => {
    pathnameValue = "/courses/3/banks/9";
    searchParamsValue = new URLSearchParams("tab=topics");
    displayCoursesValue = [{ id: 3, code: "BIOL 100", name: "Biology" }];
    render(<CourseSwitcher courseId={3} />);

    fireEvent.click(screen.getByText("open-current"));
    expect(navigate).toHaveBeenCalledWith("/courses/3?tab=topics");
  });

  it("uses name as label when no code is present", () => {
    displayCoursesValue = [{ id: 6, code: "", name: "No Code Course" }];
    render(<CourseSwitcher courseId={6} />);
    expect(screen.getByText("No Code Course")).toBeInTheDocument();
  });
});
