/**
 * Unit tests for `AccessDeniedView` (#1546): static gate shown to
 * students/TAs who cannot use Question Maker.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccessDeniedView } from "@/components/auth/AccessDeniedView";

afterEach(() => cleanup());

describe("AccessDeniedView", () => {
  it("renders the restricted-access message", () => {
    render(<AccessDeniedView />);
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.getByText(/instructors and administrators/i)).toBeInTheDocument();
    expect(screen.getByText(/Back to EduAI/i)).toBeInTheDocument();
  });
});
