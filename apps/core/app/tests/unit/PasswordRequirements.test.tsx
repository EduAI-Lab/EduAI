import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PasswordRequirements } from "~/components/password-requirements";

describe("PasswordRequirements", () => {
  it("shows both valid password options before the password is valid", () => {
    render(<PasswordRequirements password="" />);

    const eightCharacterRequirement = screen
      .getByText("8 or more characters")
      .closest("li");
    const passphraseRequirement = screen
      .getByText("16 or more characters")
      .closest("li");

    expect(eightCharacterRequirement).toHaveAttribute("data-state", "unmet");
    expect(passphraseRequirement).toHaveAttribute("data-state", "unmet");
    expect(
      eightCharacterRequirement?.compareDocumentPosition(passphraseRequirement!),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("One uppercase letter").closest("li")).toHaveAttribute(
      "data-state",
      "unmet",
    );
  });

  it("announces whether each requirement is met", () => {
    render(<PasswordRequirements password="abcdefgh" />);

    expect(
      screen.getByRole("listitem", {
        name: "Requirement met: 8 or more characters",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", {
        name: "Requirement not met: One uppercase letter",
      }),
    ).toBeInTheDocument();
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
