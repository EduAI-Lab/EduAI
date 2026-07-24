import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "../empty-state";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="No materials yet" />);
    expect(screen.getByText("No materials yet")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<EmptyState title="No materials yet" description="Upload something." />);
    expect(screen.getByText("Upload something.")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    render(<EmptyState title="No materials yet" />);
    expect(screen.queryByText("Upload something.")).not.toBeInTheDocument();
  });

  it("renders the icon when provided", () => {
    render(<EmptyState title="No materials yet" icon={<span data-testid="icon">*</span>} />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("does not render an icon wrapper when icon is omitted", () => {
    const { container } = render(<EmptyState title="No materials yet" />);
    expect(container.querySelector(".rounded-full")).not.toBeInTheDocument();
  });

  it("renders the action slot", () => {
    render(<EmptyState title="No materials yet" action={<button>Upload</button>} />);
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("renders children under the action", () => {
    render(
      <EmptyState title="No materials yet">
        <p data-testid="tips">Some tips</p>
      </EmptyState>,
    );
    expect(screen.getByTestId("tips")).toBeInTheDocument();
  });

  it("defaults to bare (no dashed-card chrome)", () => {
    const { container } = render(<EmptyState title="No materials yet" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("border-dashed");
  });

  it("applies dashed-card chrome when bare={false}", () => {
    const { container } = render(<EmptyState title="No materials yet" bare={false} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("border-dashed");
    expect(root.className).toContain("border-border");
  });

  it("uses the larger/py-12 sizing by default", () => {
    const { container } = render(<EmptyState title="No materials yet" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("py-12");
    expect(screen.getByText("No materials yet").className).toContain("text-lg");
  });

  it("uses compact sizing when size='sm'", () => {
    const { container } = render(<EmptyState title="No materials yet" size="sm" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("py-8");
    expect(screen.getByText("No materials yet").className).toContain("text-base");
  });

  it("applies custom className", () => {
    const { container } = render(<EmptyState title="No materials yet" className="my-custom-class" />);
    expect(container.querySelector(".my-custom-class")).toBeInTheDocument();
  });
});
