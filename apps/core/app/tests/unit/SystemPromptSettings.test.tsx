import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SystemPromptSettings } from "~/components/chat/system-prompt-settings";

// ---------------------------------------------------------------------------
// Trigger button
// ---------------------------------------------------------------------------

describe("SystemPromptSettings — trigger", () => {
  it("renders the System Prompt trigger button", () => {
    render(<SystemPromptSettings onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /system prompt/i })).toBeInTheDocument();
  });

  it("opens the dialog when the trigger button is clicked", () => {
    render(<SystemPromptSettings onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /system prompt/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dialog content
// ---------------------------------------------------------------------------

describe("SystemPromptSettings — dialog", () => {
  const openDialog = (onSave = vi.fn(), systemPrompt?: string) => {
    render(<SystemPromptSettings onSave={onSave} systemPrompt={systemPrompt} />);
    fireEvent.click(screen.getByRole("button", { name: /system prompt/i }));
  };

  it("renders the System Prompt textarea after opening", () => {
    openDialog();
    expect(screen.getByLabelText("System Prompt")).toBeInTheDocument();
  });

  it("pre-fills the textarea with the systemPrompt prop", () => {
    openDialog(vi.fn(), "Be concise.");
    expect(screen.getByLabelText("System Prompt")).toHaveValue("Be concise.");
  });

  it("disables the Clear button when the prompt is empty", () => {
    openDialog();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("enables the Clear button after typing a prompt", () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("System Prompt"), {
      target: { value: "You are a helpful assistant." },
    });
    expect(screen.getByRole("button", { name: "Clear" })).not.toBeDisabled();
  });

  it("calls onSave with the typed text when Save is clicked", () => {
    const onSave = vi.fn();
    openDialog(onSave);
    fireEvent.change(screen.getByLabelText("System Prompt"), {
      target: { value: "You are a helpful assistant." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("You are a helpful assistant.");
  });

  it("calls onSave with null when Clear is clicked", () => {
    const onSave = vi.fn();
    openDialog(onSave, "Existing prompt");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSave).toHaveBeenCalledWith(null);
  });
});
