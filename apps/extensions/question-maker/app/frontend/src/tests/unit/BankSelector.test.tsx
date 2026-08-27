/**
 * Unit tests for BankSelector (#1545): bank switching, "All questions"
 * fallback, and the inline create-bank flow.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BankSelector } from "@/components/question-bank/BankSelector";

afterEach(cleanup);

const banks = [
  { id: "b1", name: "Midterm bank", isDefault: true },
  { id: "b2", name: "Final bank", isDefault: false },
] as any;

describe("BankSelector", () => {
  it("shows the current bank list and default suffix", () => {
    render(
      <BankSelector
        banks={banks}
        selectedBankId={null}
        onBankChange={vi.fn()}
        onCreateBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Question bank"));
    expect(screen.getByText("Midterm bank (default)")).toBeInTheDocument();
    expect(screen.getByText("Final bank")).toBeInTheDocument();
  });

  it("switches to a specific bank", () => {
    const onBankChange = vi.fn();
    render(
      <BankSelector
        banks={banks}
        selectedBankId={null}
        onBankChange={onBankChange}
        onCreateBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Question bank"));
    fireEvent.click(screen.getByText("Final bank"));
    expect(onBankChange).toHaveBeenCalledWith("b2");
  });

  it("switches back to all questions", () => {
    const onBankChange = vi.fn();
    render(
      <BankSelector
        banks={banks}
        selectedBankId="b1"
        onBankChange={onBankChange}
        onCreateBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Question bank"));
    fireEvent.click(screen.getByText("All questions"));
    expect(onBankChange).toHaveBeenCalledWith(null);
  });

  it("creates a new bank via the inline form", async () => {
    const onCreateBank = vi.fn().mockResolvedValue(undefined);
    render(
      <BankSelector
        banks={banks}
        selectedBankId={null}
        onBankChange={vi.fn()}
        onCreateBank={onCreateBank}
      />,
    );
    fireEvent.click(screen.getByText("New bank"));
    fireEvent.change(screen.getByLabelText("New bank name"), { target: { value: "Lab bank" } });
    fireEvent.click(screen.getByText("Create"));
    expect(onCreateBank).toHaveBeenCalledWith("Lab bank");
  });

  it("disables the create button when the name is blank", () => {
    render(
      <BankSelector
        banks={banks}
        selectedBankId={null}
        onBankChange={vi.fn()}
        onCreateBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("New bank"));
    expect(screen.getByText("Create")).toBeDisabled();
  });

  it("cancels the create form", () => {
    render(
      <BankSelector
        banks={banks}
        selectedBankId={null}
        onBankChange={vi.fn()}
        onCreateBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("New bank"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByLabelText("New bank name")).not.toBeInTheDocument();
  });

  it("disables all controls when disabled is set", () => {
    render(
      <BankSelector
        banks={banks}
        selectedBankId={null}
        onBankChange={vi.fn()}
        onCreateBank={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByLabelText("Question bank")).toBeDisabled();
    expect(screen.getByText("New bank").closest("button")).toBeDisabled();
  });
});
