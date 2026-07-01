import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../theme-provider";
import { ThemeToggle } from "../theme-toggle";

describe("ThemeToggle", () => {
  it("renders a button with an accessible label", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-label");
  });

  it("renders with min-w and min-h classes for minimum size", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = screen.getByRole("button");
    expect(button.className).toMatch(/min-w/);
    expect(button.className).toMatch(/min-h/);
  });

  it("applies a custom className prop", () => {
    render(
      <ThemeProvider>
        <ThemeToggle className="custom-class" />
      </ThemeProvider>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveClass("custom-class");
  });

  it("renders an icon that is aria-hidden", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const icon = screen.getByRole("button").querySelector("[aria-hidden='true']");
    expect(icon).toBeInTheDocument();
  });

  it("has type='button' to prevent form submission", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("type", "button");
  });
});
