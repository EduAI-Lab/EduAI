import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseColorBar, COURSE_COLORS } from "../course-color-bar";

describe("CourseColorBar", () => {
  it("renders a div with the correct height", () => {
    const { container } = render(<CourseColorBar index={0} />);
    const bar = container.querySelector("div");
    expect(bar).toHaveStyle({ height: "4px" });
  });

  it("applies the correct color variable for each index", () => {
    for (let i = 0; i < COURSE_COLORS.length; i++) {
      const { container } = render(<CourseColorBar index={i} />);
      const bar = container.querySelector("div") as HTMLElement;
      expect(bar.style.getPropertyValue("--course-bar")).toBe(COURSE_COLORS[i]);
    }
  });

  it("cycles through colors when index exceeds the number of available colors", () => {
    const indexBeyondLength = COURSE_COLORS.length + 2;
    const { container } = render(<CourseColorBar index={indexBeyondLength} />);
    const bar = container.querySelector("div");
    const expectedColor = COURSE_COLORS[indexBeyondLength % COURSE_COLORS.length];
    expect((bar as HTMLElement).style.getPropertyValue("--course-bar")).toBe(expectedColor);
  });

  it("renders with the first color at index 0", () => {
    const { container } = render(<CourseColorBar index={0} />);
    const bar = container.querySelector("div") as HTMLElement;
    expect(bar.style.getPropertyValue("--course-bar")).toBe(COURSE_COLORS[0]);
  });
});
