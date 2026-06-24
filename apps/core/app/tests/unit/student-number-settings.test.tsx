import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { StudentNumberSettings } from "~/components/settings/student-number-settings";

vi.mock("~/lib/canvas/client", () => ({
  linkCanvasRoster: vi.fn(),
}));

describe("StudentNumberSettings", () => {
  it("locks the field and explains admin-only changes when a number is already linked", () => {
    render(<StudentNumberSettings initialStudentNumber="20143947" />);

    const input = screen.getByLabelText("Student number") as HTMLInputElement;
    expect(input.value).toBe("20143947");
    expect(input).toHaveAttribute("readonly");
    expect(
      screen.getByText(/only be changed by an administrator/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save student number/i }),
    ).not.toBeInTheDocument();
  });

  it("allows entering a number when none is linked yet", () => {
    render(<StudentNumberSettings initialStudentNumber={null} />);

    const input = screen.getByLabelText("Student number") as HTMLInputElement;
    expect(input).not.toHaveAttribute("readonly");
    expect(input).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: /save student number/i }),
    ).toBeInTheDocument();
  });
});
