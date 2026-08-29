import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModelFormDialog } from "~/components/admin/model-form-dialog";
import type { AIProvider, AIModel } from "~/types/ai";

const baseProvider: AIProvider = {
  id: "p1",
  name: "openai",
  displayName: "OpenAI",
  description: "OpenAI provider",
  requiresApiKey: true,
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  _count: { models: 3 },
};

const ollamaProvider: AIProvider = {
  id: "p-ollama",
  name: "ollama",
  displayName: "Ollama",
  description: "Local models",
  requiresApiKey: false,
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  _count: { models: 0 },
};

const baseModel: AIModel = {
  id: "m1",
  modelId: "gpt-4o",
  name: "GPT-4o",
  description: "Flagship model",
  type: "CHAT",
  maxTokens: 128000,
  supportsImages: true,
  supportsTools: true,
  supportsStreaming: true,
  inputPricing: 5,
  outputPricing: 15,
  isActive: true,
  routerTier: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  providerId: "p1",
  provider: {
    id: "p1",
    name: "openai",
    displayName: "OpenAI",
    description: "OpenAI provider",
    requiresApiKey: true,
    isActive: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
};

const ollamaModel: AIModel = {
  ...baseModel,
  id: "m2",
  modelId: "llama3",
  name: "Llama 3",
  providerId: "p-ollama",
  provider: {
    id: "p-ollama",
    name: "ollama",
    displayName: "Ollama",
    description: "Local models",
    requiresApiKey: false,
    isActive: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
};

const vllmProvider: AIProvider = {
  id: "p-vllm",
  name: "vllm",
  displayName: "vLLM",
  description: "Local vLLM inference",
  requiresApiKey: false,
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  _count: { models: 0 },
};

const vllmModel: AIModel = {
  ...baseModel,
  id: "m3",
  modelId: "qwen2.5-7b-instruct",
  name: "Qwen2.5 7B Instruct",
  supportsTools: false,
  providerId: "p-vllm",
  provider: {
    id: "p-vllm",
    name: "vllm",
    displayName: "vLLM",
    description: "Local vLLM inference",
    requiresApiKey: false,
    isActive: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
};

// ---------------------------------------------------------------------------
// Dialog title
// ---------------------------------------------------------------------------

describe("ModelFormDialog — title", () => {
  it("shows 'Create Model' when no model is provided", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        providers={[baseProvider]}
        onSubmit={vi.fn()}
      />,
    );
    // Use heading role to avoid matching the submit button which also says "Create Model"
    expect(screen.getByRole("heading", { name: "Create Model" })).toBeInTheDocument();
  });

  it("shows 'Edit Model' when a model is provided", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={baseModel}
        providers={[baseProvider]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("Edit Model")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Ollama section visibility
// ---------------------------------------------------------------------------

describe("ModelFormDialog — Ollama section", () => {
  it("does not render the Ollama section for a non-Ollama provider", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={baseModel}
        providers={[baseProvider]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("Ollama models")).not.toBeInTheDocument();
  });

  it("renders the Ollama section when the selected provider is Ollama", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={ollamaModel}
        providers={[ollamaProvider]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("Ollama models")).toBeInTheDocument();
  });

  it("renders the Sync models button in the Ollama section", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={ollamaModel}
        providers={[ollamaProvider]}
        onSubmit={vi.fn()}
        onFetchOllamaModels={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Sync models" })).toBeInTheDocument();
  });

  it("disables Sync models while fetching", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={ollamaModel}
        providers={[ollamaProvider]}
        onSubmit={vi.fn()}
        fetchingOllamaModels={true}
        onFetchOllamaModels={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /syncing/i })).toBeDisabled();
  });

  it("calls onFetchOllamaModels when Sync models is clicked", () => {
    const onFetchOllamaModels = vi.fn();
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={ollamaModel}
        providers={[ollamaProvider]}
        onSubmit={vi.fn()}
        onFetchOllamaModels={onFetchOllamaModels}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync models" }));
    expect(onFetchOllamaModels).toHaveBeenCalled();
  });

  it("auto-fetches Ollama models when the dialog opens with Ollama selected", async () => {
    const onFetchOllamaModels = vi.fn();
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={ollamaModel}
        providers={[ollamaProvider]}
        onSubmit={vi.fn()}
        onFetchOllamaModels={onFetchOllamaModels}
      />,
    );

    await waitFor(() => {
      expect(onFetchOllamaModels).toHaveBeenCalled();
    });
  });

  it("renders the Ollama error alert when ollamaError is set", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={ollamaModel}
        providers={[ollamaProvider]}
        onSubmit={vi.fn()}
        ollamaError="Connection refused"
      />,
    );
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// vLLM section visibility
// ---------------------------------------------------------------------------

describe("ModelFormDialog — vLLM section", () => {
  it("does not render the vLLM section for a non-vLLM provider", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={baseModel}
        providers={[baseProvider]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("vLLM models")).not.toBeInTheDocument();
  });

  it("renders the vLLM section when the selected provider is vLLM", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={vllmModel}
        providers={[vllmProvider]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("vLLM models")).toBeInTheDocument();
  });

  it("calls onFetchVllmModels when Sync models is clicked", () => {
    const onFetchVllmModels = vi.fn();
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={vllmModel}
        providers={[vllmProvider]}
        onSubmit={vi.fn()}
        onFetchVllmModels={onFetchVllmModels}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sync models/i }));
    expect(onFetchVllmModels).toHaveBeenCalled();
  });

  it("renders the vLLM error alert when vllmError is set", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={vllmModel}
        providers={[vllmProvider]}
        onSubmit={vi.fn()}
        vllmError="Connection refused"
      />,
    );
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Auto Routing Tier field
// ---------------------------------------------------------------------------

describe("ModelFormDialog — Auto Routing Tier", () => {
  it("pre-populates 'Not in Auto pool' when the model has no routerTier", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={baseModel}
        providers={[baseProvider]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Auto Routing Tier")).toHaveTextContent("Not in Auto pool");
  });

  it("pre-populates the model's existing routerTier", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={{ ...baseModel, routerTier: "TIER_3" }}
        providers={[baseProvider]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Auto Routing Tier")).toHaveTextContent(
      "Tier 3 (escalation/capable)",
    );
  });

  it("submits the selected routerTier", async () => {
    const onSubmit = vi.fn();
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={baseModel}
        providers={[baseProvider]}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByLabelText("Auto Routing Tier"));
    const tier1Option = await screen.findByRole("option", { name: /Tier 1/ });
    fireEvent.click(tier1Option);

    const submitButton = screen.getByRole("button", { name: /update model/i });
    fireEvent.submit(submitButton.closest("form")!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ routerTier: "TIER_1" }));
    });
  });

  it("submits routerTier: null when the model is cleared back to 'Not in Auto pool'", async () => {
    const onSubmit = vi.fn();
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={{ ...baseModel, routerTier: "TIER_1" }}
        providers={[baseProvider]}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByLabelText("Auto Routing Tier"));
    const noneOption = await screen.findByRole("option", { name: "Not in Auto pool" });
    fireEvent.click(noneOption);

    const submitButton = screen.getByRole("button", { name: /update model/i });
    fireEvent.submit(submitButton.closest("form")!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ routerTier: null }));
    });
  });
});

// ---------------------------------------------------------------------------
// Form submit and cancel
// ---------------------------------------------------------------------------

describe("ModelFormDialog — form actions", () => {
  it("calls onSubmit with the form data when the submit button is clicked", async () => {
    const onSubmit = vi.fn();
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={baseModel}
        providers={[baseProvider]}
        onSubmit={onSubmit}
      />,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("gpt-4o")).toBeInTheDocument();
    });
    const submitButton = screen.getByRole("button", { name: /update model/i });
    const form = submitButton.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "gpt-4o", name: "GPT-4o" }),
      );
    });
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={onOpenChange}
        providers={[baseProvider]}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("pre-populates the Model ID field from the model prop", () => {
    render(
      <ModelFormDialog
        open={true}
        onOpenChange={vi.fn()}
        model={baseModel}
        providers={[baseProvider]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Model ID")).toHaveValue("gpt-4o");
  });
});
