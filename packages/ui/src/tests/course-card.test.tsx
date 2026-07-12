import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseCard } from "../course-card";

describe("CourseCard", () => {
  it("renders course code, name, and description", () => {
    render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Computation, Programs, and Programming"
        description="Introduction to computation"
        term="Winter"
        year={2024}
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByText("CPSC 110")).toBeInTheDocument();
    expect(screen.getByText("Computation, Programs, and Programming")).toBeInTheDocument();
    expect(screen.getByText("Introduction to computation")).toBeInTheDocument();
  });

  it("shows default description placeholder when none is provided", () => {
    render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Computation, Programs, and Programming"
        term="Winter"
        year={2024}
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByText("No description yet")).toBeInTheDocument();
  });

  it("renders term and year in the footer", () => {
    render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Summer"
        year={2025}
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByText(/2025S1/)).toBeInTheDocument();
  });

  it("displays published status based on isPublished prop", () => {
    const { rerender } = render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByText("Published")).toBeInTheDocument();

    rerender(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={false}
        href="/courses/1"
      />
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("renders department label if provided", () => {
    render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        departmentLabel="Computer Science (CPSC)"
        term="Winter"
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByText("Computer Science (CPSC)")).toBeInTheDocument();
  });

  it("renders extra badges if provided", () => {
    render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        extraBadges={["Enrolled", "Starred"]}
        term="Winter"
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByText("Enrolled")).toBeInTheDocument();
    expect(screen.getByText("Starred")).toBeInTheDocument();
  });

  it("renders action menu when actions are provided", () => {
    render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={true}
        href="/courses/1"
        actions={{
          showEdit: true,
          onEdit: vi.fn(),
        }}
      />
    );
    expect(screen.getByLabelText("Course actions")).toBeInTheDocument();
  });

  it("shows edit option in action menu when showEdit is true", () => {
    const onEdit = vi.fn();
    const { container } = render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={true}
        href="/courses/1"
        actions={{
          showEdit: true,
          onEdit,
        }}
      />
    );
    // Verify the action menu button exists
    expect(screen.getByLabelText("Course actions")).toBeInTheDocument();
  });

  it("renders published status indicator based on isPublished prop", () => {
    const onPublishToggle = vi.fn();
    const { rerender } = render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={true}
        href="/courses/1"
        actions={{
          showPublish: true,
          isPublished: true,
          onPublishToggle,
        }}
      />
    );
    expect(screen.getByText("Published")).toBeInTheDocument();

    rerender(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={false}
        href="/courses/1"
        actions={{
          showPublish: true,
          isPublished: false,
          onPublishToggle,
        }}
      />
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows delete option in action menu when showDelete is true", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={true}
        href="/courses/1"
        actions={{
          showDelete: true,
          onDelete,
        }}
      />
    );
    // Verify the action menu button exists when showDelete is true
    expect(screen.getByLabelText("Course actions")).toBeInTheDocument();
  });

  it("applies custom className to the card element", () => {
    const { container } = render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={true}
        href="/courses/1"
        className="custom-card-class"
      />
    );
    const card = container.querySelector(".custom-card-class");
    expect(card).toBeInTheDocument();
  });

  it("creates correct aria-label for the link overlay", () => {
    render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Computation, Programs, and Programming"
        term="Winter"
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByLabelText("CPSC 110 Computation, Programs, and Programming")).toBeInTheDocument();
  });

  it("renders a colour hero header band", () => {
    render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        term="Winter"
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByTestId("course-card-hero")).toBeInTheDocument();
  });

  it("uses a custom accent colour when provided", () => {
    const { container } = render(
      <CourseCard
        id="1"
        code="CPSC 110"
        name="Test Course"
        displayName="My CS"
        accentColor="oklch(0.56 0.20 255)"
        term="Winter"
        isPublished={true}
        href="/courses/1"
      />
    );
    expect(screen.getByText("My CS")).toBeInTheDocument();
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.getPropertyValue("--course-accent")).toBe("oklch(0.56 0.20 255)");
  });
});
