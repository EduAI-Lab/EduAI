import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { StudentNumberSettings } from "~/components/settings/student-number-settings";
import { linkCanvasRoster } from "~/lib/canvas/client";

vi.mock("~/lib/canvas/client", () => ({
  linkCanvasRoster: vi.fn(),
}));

describe("StudentNumberSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the student number field and save button", () => {
    render(<StudentNumberSettings initialStudentNumber={null} />);

    expect(screen.getByLabelText("Student number")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save student number" }),
    ).toBeDisabled();
  });

  it("prefills an existing student number and disables save until changed", () => {
    render(<StudentNumberSettings initialStudentNumber="student_1" />);

    expect(screen.getByDisplayValue("student_1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save student number" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Student number"), {
      target: { value: "student_2" },
    });

    expect(
      screen.getByRole("button", { name: "Save student number" }),
    ).not.toBeDisabled();
  });

  it("calls linkCanvasRoster and shows success", async () => {
    vi.mocked(linkCanvasRoster).mockResolvedValue({
      studentId: "student_2",
      enrollmentsLinked: 2,
    });

    render(<StudentNumberSettings initialStudentNumber="student_1" />);

    fireEvent.change(screen.getByLabelText("Student number"), {
      target: { value: "student_2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save student number" }));

    await waitFor(() => {
      expect(linkCanvasRoster).toHaveBeenCalledWith("student_2");
    });

    expect(
      screen.getByText(/2 course enrollment\(s\) linked/i),
    ).toBeInTheDocument();
  });

  it("shows an error when linkCanvasRoster fails", async () => {
    vi.mocked(linkCanvasRoster).mockRejectedValue(
      new Error("This student number is already linked to another account."),
    );

    render(<StudentNumberSettings initialStudentNumber={null} />);

    fireEvent.change(screen.getByLabelText("Student number"), {
      target: { value: "student_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save student number" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "This student number is already linked to another account.",
        ),
      ).toBeInTheDocument();
    });
  });
});
