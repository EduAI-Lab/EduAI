import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  CourseInstructorsPanel,
  instructorsBadgeLabel,
  resolveDisplayInstructors,
} from "~/components/courses/course-instructors-panel";

const ABDALLAH = {
  id: "u-abdallah",
  name: "Dr Abdallah",
  email: "abdallah@ubc.ca",
  isPrimary: true,
};
const MOSTAFA = { id: "u-mostafa", name: "Dr Mostafa", email: "mostafa@ubc.ca", isPrimary: false };
const FAHD = { id: "u-fahd", name: "Fahd", email: "fahd@ubc.ca", isPrimary: false };

describe("resolveDisplayInstructors", () => {
  it("prefers the full set over the single legacy field", () => {
    const resolved = resolveDisplayInstructors({
      instructor: { name: "Dr Abdallah", email: "abdallah@ubc.ca" },
      instructors: [ABDALLAH, MOSTAFA, FAHD],
    });
    expect(resolved.map((row) => row.name)).toEqual(["Dr Abdallah", "Dr Mostafa", "Fahd"]);
  });

  it("falls back to the single field for a pre-#1841 payload", () => {
    // Cached client state and older responses carry only `instructor`; showing
    // nothing would be a worse regression than showing one.
    const resolved = resolveDisplayInstructors({
      instructor: { name: "Dr Abdallah", email: "abdallah@ubc.ca" },
    });
    expect(resolved).toEqual([
      { id: "abdallah@ubc.ca", name: "Dr Abdallah", email: "abdallah@ubc.ca", isPrimary: true },
    ]);
  });

  it("falls back when the set is present but empty", () => {
    const resolved = resolveDisplayInstructors({
      instructor: { name: "Dr Abdallah", email: "abdallah@ubc.ca" },
      instructors: [],
    });
    expect(resolved).toHaveLength(1);
  });

  it("returns nothing when the course has no instructor at all", () => {
    expect(resolveDisplayInstructors({ instructor: null, instructors: [] })).toEqual([]);
    expect(resolveDisplayInstructors({})).toEqual([]);
  });
});

describe("CourseInstructorsPanel", () => {
  it("renders every instructor, not just the primary", () => {
    render(<CourseInstructorsPanel instructors={[ABDALLAH, MOSTAFA, FAHD]} />);

    expect(screen.getByText("Dr Abdallah")).toBeInTheDocument();
    expect(screen.getByText("Dr Mostafa")).toBeInTheDocument();
    expect(screen.getByText("Fahd")).toBeInTheDocument();
  });

  it("uses a plural heading for several and a singular one for one", () => {
    const { unmount } = render(<CourseInstructorsPanel instructors={[ABDALLAH, MOSTAFA]} />);
    expect(screen.getByText("Instructors")).toBeInTheDocument();
    unmount();

    render(<CourseInstructorsPanel instructors={[ABDALLAH]} />);
    expect(screen.getByText("Instructor")).toBeInTheDocument();
  });

  it("omits the contact line when the email is redacted for a student", () => {
    render(<CourseInstructorsPanel instructors={[{ ...ABDALLAH, email: null }]} />);

    expect(screen.getByText("Dr Abdallah")).toBeInTheDocument();
    expect(screen.queryByText("abdallah@ubc.ca")).not.toBeInTheDocument();
  });

  it("renders the TA slot passed as children", () => {
    render(
      <CourseInstructorsPanel instructors={[ABDALLAH]}>
        <span>Teaching assistants</span>
      </CourseInstructorsPanel>,
    );
    expect(screen.getByText("Teaching assistants")).toBeInTheDocument();
  });
});

describe("instructorsBadgeLabel", () => {
  it("names a single instructor", () => {
    expect(instructorsBadgeLabel([ABDALLAH])).toBe("Dr Abdallah");
  });

  it("names the first of two and counts the rest", () => {
    expect(instructorsBadgeLabel([ABDALLAH, MOSTAFA])).toBe("Dr Abdallah +1");
  });

  it("counts three or more rather than overflowing the card", () => {
    expect(instructorsBadgeLabel([ABDALLAH, MOSTAFA, FAHD])).toBe("3 instructors");
  });

  it("returns null for none, so the badge is omitted rather than reading '0 instructors'", () => {
    expect(instructorsBadgeLabel([])).toBeNull();
  });
});
