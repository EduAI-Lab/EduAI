import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangePasswordSettings } from "~/components/settings/change-password-settings";
import { authClient } from "~/lib/auth/client";

vi.mock("~/lib/auth/client", () => ({
  authClient: {
    changePassword: vi.fn(),
  },
}));

function fillForm({
  current = "oldpass1",
  next = "NewPass123!",
  confirm = "NewPass123!",
}: { current?: string; next?: string; confirm?: string } = {}) {
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirm },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChangePasswordSettings", () => {
  it("renders the form with an initially disabled submit button", () => {
    render(<ChangePasswordSettings />);

    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /change password/i }),
    ).toBeDisabled();
  });

  it("flags a mismatched confirmation and keeps submit disabled", () => {
    render(<ChangePasswordSettings />);

    fillForm({ confirm: "SomethingElse1" });

    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    const confirmInput = screen.getByLabelText("Confirm new password");
    expect(confirmInput).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("button", { name: /change password/i }),
    ).toBeDisabled();
  });

  it("enables submit once all fields are filled and passwords match", () => {
    render(<ChangePasswordSettings />);

    fillForm();

    expect(
      screen.getByRole("button", { name: /change password/i }),
    ).not.toBeDisabled();
  });

  it("submits successfully, shows a success message, and clears the fields", async () => {
    vi.mocked(authClient.changePassword).mockResolvedValue({
      data: {},
      error: null,
    } as never);

    render(<ChangePasswordSettings />);
    fillForm();

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Password changed successfully.",
      ),
    );

    expect(authClient.changePassword).toHaveBeenCalledWith({
      currentPassword: "oldpass1",
      newPassword: "NewPass123!",
      revokeOtherSessions: false,
    });
    expect(
      (screen.getByLabelText("Current password") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("New password") as HTMLInputElement).value,
    ).toBe("");
  });

  it("shows the server error message when the API call returns an error", async () => {
    vi.mocked(authClient.changePassword).mockResolvedValue({
      data: null,
      error: { message: "Current password is incorrect" },
    } as never);

    render(<ChangePasswordSettings />);
    fillForm();

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Current password is incorrect",
      ),
    );
  });

  it("falls back to a generic error message when the thrown error has no message", async () => {
    vi.mocked(authClient.changePassword).mockRejectedValue(new Error("boom"));

    render(<ChangePasswordSettings />);
    fillForm();

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not change your password. Please try again.",
      ),
    );
  });
});
