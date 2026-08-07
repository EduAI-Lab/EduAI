import { describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { render, screen } from "@testing-library/react";

import { StudentIdOnboardingForm } from "~/components/onboarding/student-id-onboarding-form";

function renderForm(props: Partial<React.ComponentProps<typeof StudentIdOnboardingForm>> = {}) {
  const router = createMemoryRouter(
    [{ path: "/", element: <StudentIdOnboardingForm {...props} /> }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("StudentIdOnboardingForm", () => {
  it("renders the student number field and actions", () => {
    renderForm();

    expect(screen.getByRole("heading", { name: /link your ubc student number/i })).toBeInTheDocument();
    expect(screen.getByLabelText("UBC Student Number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link student number" })).toBeInTheDocument();
  });

  it("shows a form error when provided", () => {
    renderForm({ formError: "This student number is already linked to another account. Contact an admin if you believe this is an error." });

    expect(screen.getByRole("alert")).toHaveTextContent("already linked to another account");
  });

  it("constrains the student number field to 8 digits (#818)", () => {
    renderForm();
    const input = screen.getByLabelText("UBC Student Number");
    expect(input).toHaveAttribute("pattern", "\\d{8}");
    expect(input).toHaveAttribute("minLength", "8");
    expect(input).toHaveAttribute("maxLength", "8");
  });
});
