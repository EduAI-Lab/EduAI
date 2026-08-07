import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AIModelsTable } from "~/components/admin/ai-models-table";

const baseProvider = {
  id: "p1",
  name: "openai",
  displayName: "OpenAI",
  description: "OpenAI provider",
  requiresApiKey: true,
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const baseModel = {
  id: "m1",
  modelId: "gpt-4o",
  name: "GPT-4o",
  description: "Flagship model",
  type: "CHAT" as const,
  maxTokens: 128000,
  supportsImages: true,
  supportsTools: true,
  supportsStreaming: true,
  inputPricing: 5,
  outputPricing: 15,
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  providerId: "p1",
  provider: baseProvider,
};

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("AIModelsTable — empty state", () => {
  it("renders the empty state message when models is empty", () => {
    render(
      <AIModelsTable models={[]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("No models found.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("AIModelsTable — rendering", () => {
  it("renders the model name and modelId", () => {
    render(
      <AIModelsTable models={[baseModel]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  it("renders the provider display name", () => {
    render(
      <AIModelsTable models={[baseModel]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
  });

  it("renders one row per model", () => {
    const models = [
      baseModel,
      { ...baseModel, id: "m2", name: "GPT-3.5", modelId: "gpt-3.5-turbo" },
    ];
    render(
      <AIModelsTable models={models} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    expect(screen.getByText("GPT-3.5")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("AIModelsTable — callbacks", () => {
  it("calls onEdit with the model when the edit button is clicked", () => {
    const onEdit = vi.fn();
    render(
      <AIModelsTable models={[baseModel]} onEdit={onEdit} onDelete={vi.fn()} onToggleActive={vi.fn()} />
    );
    const [editBtn] = screen.getAllByRole("button");
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(baseModel);
  });

  it("calls onDelete with the model id after confirming the delete dialog", () => {
    const onDelete = vi.fn();
    render(
      <AIModelsTable models={[baseModel]} onEdit={vi.fn()} onDelete={onDelete} onToggleActive={vi.fn()} />
    );
    const [, trashBtn] = screen.getAllByRole("button");
    fireEvent.click(trashBtn);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("m1");
  });

  it("does not call onDelete when the delete dialog is cancelled", () => {
    const onDelete = vi.fn();
    render(
      <AIModelsTable models={[baseModel]} onEdit={vi.fn()} onDelete={onDelete} onToggleActive={vi.fn()} />
    );
    const [, trashBtn] = screen.getAllByRole("button");
    fireEvent.click(trashBtn);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("calls onToggleActive with the model when the active switch is clicked", () => {
    const onToggleActive = vi.fn();
    render(
      <AIModelsTable models={[baseModel]} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={onToggleActive} />
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggleActive).toHaveBeenCalledWith(baseModel);
  });
});
