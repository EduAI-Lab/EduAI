import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PasswordRequirements } from "~/components/password-requirements";

describe("PasswordRequirements", () => {
  it("shows both valid password options before the password is valid", () => {
    render(<PasswordRequirements password="" />);

    expect(screen.getByText("16 or more characters").closest("li")).toHaveAttribute(
      "data-state",
      "unmet",
    );
    expect(screen.getByText("8 or more characters").closest("li")).toHaveAttribute(
      "data-state",
      "unmet",
    );
    expect(screen.getByText("One uppercase letter").closest("li")).toHaveAttribute(
      "data-state",
      "unmet",
    );
  });

  it("updates individual requirements as the user types", () => {
    render(<PasswordRequirements password="abcdefgh" />);

    expect(screen.getByText("8 or more characters").closest("li")).toHaveAttribute(
      "data-state",
      "met",
    );
    expect(screen.getByText("One lowercase letter").closest("li")).toHaveAttribute(
      "data-state",
      "met",
    );
    expect(screen.getByText("One uppercase letter").closest("li")).toHaveAttribute(
      "data-state",
      "unmet",
    );
    expect(screen.getByText("One number").closest("li")).toHaveAttribute(
      "data-state",
      "unmet",
    );
  });

  it("shows success for a valid complex password", () => {
    render(<PasswordRequirements password="StrongPass1!" />);

    expect(screen.getByText("Password meets requirements.")).toBeInTheDocument();
  });

  it("shows success for a 16-character passphrase", () => {
    render(<PasswordRequirements password="a long passphrase" />);

    expect(screen.getByText("Password meets requirements.")).toBeInTheDocument();
  });
});
