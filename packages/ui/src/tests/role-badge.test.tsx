import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoleBadge } from "../role-badge";

describe("RoleBadge", () => {
  it("renders the human-readable label for each known role", () => {
    const cases: Array<[string, string]> = [
      ["ADMIN", "Admin"],
      ["UNIT_ADMIN", "Unit Admin"],
      ["INSTRUCTOR", "Instructor"],
      ["TA", "TA"],
      ["STUDENT", "Student"],
    ];
    for (const [role, label] of cases) {
      const { unmount } = render(<RoleBadge role={role} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("falls back to the Student config for an unknown role", () => {
    render(<RoleBadge role="WIZARD" />);
    expect(screen.getByText("Student")).toBeInTheDocument();
  });

  it("applies a passed className to the badge element", () => {
    render(<RoleBadge role="ADMIN" className="custom-class" />);
    expect(screen.getByText("Admin").closest("span.custom-class")).not.toBeNull();
  });
});
