import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_COURSE_PALETTE } from "../course-theme";
import { CourseHeroCard } from "../course-hero-card";

const ACCENT = DEFAULT_COURSE_PALETTE[0];

describe("CourseHeroCard", () => {
  it("renders course code, term, year, and name", () => {
    render(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        year={2024}
        name="Computation, Programs, and Programming"
        accentColor={ACCENT}
      />
    );
    expect(screen.getByText(/CPSC 110 · Winter 2024/)).toBeInTheDocument();
    expect(screen.getByText("CPSC 110: Computation, Programs, and Programming")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        name="Test Course"
        description="An introduction to programming"
        accentColor={ACCENT}
      />
    );
    expect(screen.getByText("An introduction to programming")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    render(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        name="Test Course"
        accentColor={ACCENT}
      />
    );
    expect(screen.queryByText(/An introduction/)).not.toBeInTheDocument();
  });

  it("renders topic chips when provided", () => {
    render(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        name="Test Course"
        topics={["Python", "Variables", "Functions"]}
        accentColor={ACCENT}
      />
    );
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("Variables")).toBeInTheDocument();
    expect(screen.getByText("Functions")).toBeInTheDocument();
  });

  it("renders bottom badges when provided", () => {
    render(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        name="Test Course"
        badges={["Active", "Popular"]}
        accentColor={ACCENT}
      />
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Popular")).toBeInTheDocument();
  });

  it("renders top right badges when provided", () => {
    render(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        name="Test Course"
        topRightBadges={["Instructor", "TBD"]}
        accentColor={ACCENT}
      />
    );
    expect(screen.getByText("Instructor")).toBeInTheDocument();
    expect(screen.getByText("TBD")).toBeInTheDocument();
  });

  it("handles year as a string or number", () => {
    const { rerender } = render(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        year="2024"
        name="Test Course"
        accentColor={ACCENT}
      />
    );
    expect(screen.getByText(/Winter 2024/)).toBeInTheDocument();

    rerender(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        year={2024}
        name="Test Course"
        accentColor={ACCENT}
      />
    );
    expect(screen.getByText(/Winter 2024/)).toBeInTheDocument();
  });

  it("applies custom className to the container", () => {
    const { container } = render(
      <CourseHeroCard
        code="CPSC 110"
        term="Winter"
        name="Test Course"
        className="custom-hero-class"
        accentColor={ACCENT}
      />
    );
    const hero = container.querySelector(".custom-hero-class");
    expect(hero).toBeInTheDocument();
  });
});
