import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AtRoleBanner } from "~/components/rbac/AtRoleBanner";

describe("AtRoleBanner", () => {
  it("shows TA read-only copy", () => {
    render(<AtRoleBanner role="TA" variant="ta" />);
    expect(screen.getByTestId("at-role-banner-ta")).toBeTruthy();
    expect(screen.getByText(/Teaching assistant view/i)).toBeTruthy();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it("shows authorized units for unit admin", () => {
    render(
      <AtRoleBanner role="UNIT_ADMIN" variant="unit-admin" authorizedUnits={["COSC", "MATH"]} />,
    );
    expect(screen.getByText(/Authorized units:/)).toBeTruthy();
    expect(screen.getByText(/COSC, MATH/)).toBeTruthy();
  });

  it("does not show authorized units when the list is empty", () => {
    render(<AtRoleBanner role="UNIT_ADMIN" variant="unit-admin" authorizedUnits={[]} />);
    expect(screen.queryByText(/Authorized units:/)).not.toBeInTheDocument();
  });

  it("does not show authorized units for a non unit-admin variant even if provided", () => {
    render(<AtRoleBanner role="INSTRUCTOR" authorizedUnits={["COSC"]} />);
    expect(screen.queryByText(/Authorized units:/)).not.toBeInTheDocument();
  });

  it.each([
    ["ADMIN", "admin", "Administrator view"],
    ["UNIT_ADMIN", "unit-admin", "Unit administrator view"],
    ["INSTRUCTOR", "instructor", "Instructor view"],
    ["TA", "ta", "Teaching assistant view"],
    ["STUDENT", "student", "Student view"],
  ] as const)("derives the %s variant from role when no variant is given", (role, view, title) => {
    render(<AtRoleBanner role={role} />);
    expect(screen.getByTestId(`at-role-banner-${view}`)).toBeTruthy();
    expect(screen.getByText(title)).toBeTruthy();
  });

  it("shows the role view label footer", () => {
    render(<AtRoleBanner role="ADMIN" />);
    expect(screen.getByText("Administrator")).toBeTruthy();
  });
});
