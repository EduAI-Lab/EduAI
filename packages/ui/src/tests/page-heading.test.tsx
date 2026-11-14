import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeading } from "../page-heading";

describe("PageHeading", () => {
  it("renders the heading text", () => {
    render(<PageHeading heading="Courses" />);
    expect(screen.getByText("Courses")).toBeInTheDocument();
  });

  it("renders a gold accent bar below the heading", () => {
    const { container } = render(<PageHeading heading="Courses" />);
    const bar = container.querySelector("div[style*='var(--gold)']");
    expect(bar).toBeInTheDocument();
  });

  it("renders subheading when provided", () => {
    render(<PageHeading heading="Courses" subheading="Manage your courses" />);
    expect(screen.getByText("Manage your courses")).toBeInTheDocument();
  });

  it("does not render subheading when not provided", () => {
    render(<PageHeading heading="Courses" />);
    expect(screen.queryByText(/Manage/)).not.toBeInTheDocument();
  });

  it("renders subheading as React node", () => {
    render(
      <PageHeading
        heading="Courses"
        subheading={<span data-testid="node-subheading">Custom subheading</span>}
      />,
    );
    expect(screen.getByTestId("node-subheading")).toBeInTheDocument();
    expect(screen.getByText("Custom subheading")).toBeInTheDocument();
  });

  it("applies custom className to the container", () => {
    const { container } = render(
      <PageHeading heading="Courses" className="custom-heading-container" />,
    );
    const div = container.querySelector(".custom-heading-container");
    expect(div).toBeInTheDocument();
  });

  it("keeps the band when a className is passed, and drops it with banded={false}", () => {
    const { container, rerender } = render(<PageHeading heading="Courses" className="mb-4" />);
    expect(container.firstElementChild).toHaveClass("bg-muted/50", "mb-4");

    rerender(<PageHeading heading="Courses" className="mb-4" banded={false} />);
    expect(container.firstElementChild).not.toHaveClass("bg-muted/50");
    expect(container.firstElementChild).toHaveClass("mb-4");
  });

  it("puts the page's actions on the title row beside the heading", () => {
    render(
      <PageHeading
        heading="Invitations"
        className="page-header"
        actions={<button type="button">Invite User</button>}
      />,
    );
    const button = screen.getByRole("button", { name: "Invite User" });
    const row = button.closest(".page-header");
    expect(row).toContainElement(screen.getByRole("heading", { name: "Invitations" }));
  });
});
