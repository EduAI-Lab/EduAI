import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProvidersTable } from "~/components/admin/providers-table";

const baseProvider = {
  id: "p1",
  name: "openai",
  displayName: "OpenAI",
  description: "Hosted AI models from OpenAI",
  requiresApiKey: true,
  envVarName: "OPENAI_API_KEY",
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  _count: { models: 3 },
};

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("ProvidersTable — empty state", () => {
  it("renders the empty state message when providers is empty", () => {
    render(
      <ProvidersTable providers={[]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("No providers found.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ProvidersTable — rendering", () => {
  it("renders the provider display name and description", () => {
    render(
      <ProvidersTable providers={[baseProvider]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Hosted AI models from OpenAI")).toBeInTheDocument();
  });

  it("renders the model count badge", () => {
    render(
      <ProvidersTable providers={[baseProvider]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders the env var name", () => {
    render(
      <ProvidersTable providers={[baseProvider]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
  });

  it("renders 'None' when no env var is set", () => {
    render(
      <ProvidersTable
        providers={[{ ...baseProvider, envVarName: undefined }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleActive={vi.fn()}
      />
    );
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("renders one row per provider", () => {
    const providers = [
      baseProvider,
      { ...baseProvider, id: "p2", name: "google", displayName: "Google" },
    ];
    render(
      <ProvidersTable providers={providers} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("ProvidersTable — callbacks", () => {
  it("calls onEdit with the provider when the edit button is clicked", () => {
    const onEdit = vi.fn();
    render(
      <ProvidersTable providers={[baseProvider]} onEdit={onEdit} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    const [editBtn] = screen.getAllByRole("button");
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(baseProvider);
  });

  it("calls onDelete with the provider id after confirming the delete dialog", () => {
    const onDelete = vi.fn();
    render(
      <ProvidersTable providers={[baseProvider]} onEdit={vi.fn()} onDelete={onDelete} onToggleActive={vi.fn()} />
    );
    const [, trashBtn] = screen.getAllByRole("button");
    fireEvent.click(trashBtn);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("p1");
  });

  it("does not call onDelete when the delete dialog is cancelled", () => {
    const onDelete = vi.fn();
    render(
      <ProvidersTable providers={[baseProvider]} onEdit={vi.fn()} onDelete={onDelete} onToggleActive={vi.fn()} />
    );
    const [, trashBtn] = screen.getAllByRole("button");
    fireEvent.click(trashBtn);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("calls onToggleActive with the provider when the active switch is clicked", () => {
    const onToggleActive = vi.fn();
    render(
      <ProvidersTable providers={[baseProvider]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={onToggleActive} />
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggleActive).toHaveBeenCalledWith(baseProvider);
  });
});
