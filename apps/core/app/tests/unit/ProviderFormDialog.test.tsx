import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderFormDialog } from "~/components/admin/provider-form-dialog";

const baseProvider = {
  id: "p1",
  name: "openai",
  displayName: "OpenAI",
  description: "OpenAI hosted models",
  requiresApiKey: true,
  envVarName: "OPENAI_API_KEY",
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  _count: { models: 3 },
};

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

describe("ProviderFormDialog — title", () => {
  it("shows 'Create Provider' when no provider is given", () => {
    render(
      <ProviderFormDialog open={true} onOpenChange={vi.fn()} onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Create Provider" })).toBeInTheDocument();
  });

  it("shows 'Edit Provider' when a provider is given", () => {
    render(
      <ProviderFormDialog
        open={true}
        onOpenChange={vi.fn()}
        provider={baseProvider}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { name: "Edit Provider" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pre-population
// ---------------------------------------------------------------------------

describe("ProviderFormDialog — pre-population", () => {
  it("pre-fills the Name (ID) field from the provider prop", () => {
    render(
      <ProviderFormDialog
        open={true}
        onOpenChange={vi.fn()}
        provider={baseProvider}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Name (ID)")).toHaveValue("openai");
  });

  it("pre-fills the Display Name field from the provider prop", () => {
    render(
      <ProviderFormDialog
        open={true}
        onOpenChange={vi.fn()}
        provider={baseProvider}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Display Name")).toHaveValue("OpenAI");
  });
});

// ---------------------------------------------------------------------------
// Form actions
// ---------------------------------------------------------------------------

describe("ProviderFormDialog — form actions", () => {
  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <ProviderFormDialog open={true} onOpenChange={onOpenChange} onSubmit={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onSubmit with the provider data when the form is submitted", () => {
    const onSubmit = vi.fn();
    render(
      <ProviderFormDialog
        open={true}
        onOpenChange={vi.fn()}
        provider={baseProvider}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /update provider/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "openai", displayName: "OpenAI" })
    );
  });

  it("shows 'Create Provider' submit button when no provider", () => {
    render(
      <ProviderFormDialog open={true} onOpenChange={vi.fn()} onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /create provider/i })).toBeInTheDocument();
  });
});
