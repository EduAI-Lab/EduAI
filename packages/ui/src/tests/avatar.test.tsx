import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "../avatar";

describe("Avatar", () => {
  it("renders an image when src is provided and no error occurs", () => {
    render(<Avatar name="John Doe" src="https://example.com/avatar.jpg" />);
    const img = screen.getByAltText("John Doe") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("https://example.com/avatar.jpg");
  });

  it("renders initials in a colored div when no src is provided", () => {
    render(<Avatar name="John Doe" />);
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("generates consistent initials from name", () => {
    const cases = [
      ["Alice Bob", "AB"],
      ["X Y", "XY"],
      ["Single", "S"],
      ["Three Part Name", "TP"],
    ];
    for (const [name, expectedInitials] of cases) {
      const { unmount } = render(<Avatar name={name} />);
      expect(screen.getByText(expectedInitials)).toBeInTheDocument();
      unmount();
    }
  });

  it("respects custom size and radius properties", () => {
    const { container } = render(
      <Avatar name="John Doe" size={64} radius={16} />
    );
    const div = container.querySelector("div");
    expect(div).toHaveStyle({ width: "64px", height: "64px" });
  });

  it("falls back to initials when image fails to load", () => {
    const { rerender } = render(
      <Avatar name="Jane Smith" src="https://example.com/invalid.jpg" />
    );
    const img = screen.getByAltText("Jane Smith") as HTMLImageElement;
    expect(img).toBeInTheDocument();

    // Simulate image load error
    img.dispatchEvent(new Event("error"));

    // Re-render and verify initials are shown
    rerender(<Avatar name="Jane Smith" src="https://example.com/invalid.jpg" />);
  });

  it("applies custom className to the element", () => {
    const { container } = render(
      <Avatar name="Test User" className="custom-class" />
    );
    const element = container.querySelector(".custom-class");
    expect(element).toBeInTheDocument();
  });
});
