import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApiKeySettings } from "~/components/chat/api-key-settings";
import type { UserProviderSettings } from "~/lib/ai/providers";

const noKeys: UserProviderSettings = {};
const withOpenAIKey: UserProviderSettings = {
  openai: { apiKey: "sk-testkey12345", isEnabled: true },
};

const noConfigure = (_p: string) => false;
const onlyOpenAI = (p: string) => p === "openai";

const makeProps = (overrides: Record<string, any> = {}) => ({
  open: true,
  onOpenChange: vi.fn(),
  apiKeys: noKeys,
  isProviderConfigured: noConfigure,
  onUpdateProvider: vi.fn(),
  onRemoveProvider: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ApiKeySettings — rendering", () => {
  it("renders all four provider card labels when open", () => {
    render(<ApiKeySettings {...makeProps()} />);
    expect(screen.getByText("OpenAI API Key")).toBeInTheDocument();
    expect(screen.getByText("Google AI API Key")).toBeInTheDocument();
    expect(screen.getByText("OpenRouter API Key")).toBeInTheDocument();
    expect(screen.getByText("Ollama (Local)")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<ApiKeySettings {...makeProps({ open: false })} />);
    expect(screen.queryByText("OpenAI API Key")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Unconfigured providers
// ---------------------------------------------------------------------------

describe("ApiKeySettings — unconfigured providers", () => {
  it("shows the Save OpenAI Key button for an unconfigured OpenAI provider", () => {
    render(<ApiKeySettings {...makeProps()} />);
    expect(screen.getByRole("button", { name: /save openai key/i })).toBeInTheDocument();
  });

  it("disables the Save OpenAI Key button when the input is empty", () => {
    render(<ApiKeySettings {...makeProps()} />);
    expect(screen.getByRole("button", { name: /save openai key/i })).toBeDisabled();
  });

  it("enables the Save OpenAI Key button after typing a key", () => {
    render(<ApiKeySettings {...makeProps()} />);
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-mykey" },
    });
    expect(screen.getByRole("button", { name: /save openai key/i })).not.toBeDisabled();
  });

  it("calls onUpdateProvider with the key when Save OpenAI Key is clicked", () => {
    const onUpdateProvider = vi.fn();
    render(<ApiKeySettings {...makeProps({ onUpdateProvider })} />);
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-mykey" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save openai key/i }));
    expect(onUpdateProvider).toHaveBeenCalledWith("openai", {
      apiKey: "sk-mykey",
      isEnabled: true,
    });
  });

  it("shows the Enable Ollama button for an unconfigured Ollama provider", () => {
    render(<ApiKeySettings {...makeProps()} />);
    expect(screen.getByRole("button", { name: /enable ollama/i })).toBeInTheDocument();
  });

  it("calls onUpdateProvider with isEnabled when Enable Ollama is clicked", () => {
    const onUpdateProvider = vi.fn();
    render(<ApiKeySettings {...makeProps({ onUpdateProvider })} />);
    fireEvent.click(screen.getByRole("button", { name: /enable ollama/i }));
    expect(onUpdateProvider).toHaveBeenCalledWith("ollama", { isEnabled: true });
  });
});

// ---------------------------------------------------------------------------
// Configured provider
// ---------------------------------------------------------------------------

describe("ApiKeySettings — configured provider", () => {
  it("shows an Active badge for a configured provider", () => {
    render(
      <ApiKeySettings
        {...makeProps({ apiKeys: withOpenAIKey, isProviderConfigured: onlyOpenAI })}
      />
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders a readOnly masked input for a configured provider", () => {
    render(
      <ApiKeySettings
        {...makeProps({ apiKeys: withOpenAIKey, isProviderConfigured: onlyOpenAI })}
      />
    );
    // Dialog portals render into document.body, not the render container
    const readonlyInput = document.body.querySelector("input[readonly]");
    expect(readonlyInput).toBeInTheDocument();
    expect(readonlyInput).toHaveAttribute("type", "password");
  });

  it("switches the key input to type=text when the show key button is clicked", () => {
    render(
      <ApiKeySettings
        {...makeProps({ apiKeys: withOpenAIKey, isProviderConfigured: onlyOpenAI })}
      />
    );
    const readonlyInput = document.body.querySelector("input[readonly]")!;
    // Eye button is first in the configured provider row
    const [eyeBtn] = screen.getAllByRole("button");
    fireEvent.click(eyeBtn);
    expect(readonlyInput).toHaveAttribute("type", "text");
  });

  it("calls onRemoveProvider with the provider id when the delete button is clicked", () => {
    const onRemoveProvider = vi.fn();
    render(
      <ApiKeySettings
        {...makeProps({
          apiKeys: withOpenAIKey,
          isProviderConfigured: onlyOpenAI,
          onRemoveProvider,
        })}
      />
    );
    // Trash button is second (eye button is first) among all buttons
    const [, trashBtn] = screen.getAllByRole("button");
    fireEvent.click(trashBtn);
    expect(onRemoveProvider).toHaveBeenCalledWith("openai");
  });
});
