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

    expect(screen.getByRole("heading", { name: /link your student number/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Student number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
  });

  it("shows a form error when provided", () => {
    renderForm({ formError: "This student number is already linked to another account." });

    expect(screen.getByRole("alert")).toHaveTextContent("already linked");
  });
});
