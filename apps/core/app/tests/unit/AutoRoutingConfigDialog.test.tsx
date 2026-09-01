import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AutoRoutingConfigDialog } from "~/components/admin/auto-routing-config-dialog";
import type { AIModel } from "~/hooks/api/types";

const provider = {
  id: "provider-1",
  name: "vllm",
  displayName: "vLLM",
  description: "Local models",
  requiresApiKey: false,
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  _count: { models: 2 },
};

const models = [
  {
    id: "small-model",
    modelId: "qwen-small",
    name: "Qwen Small",
    description: "Fast model",
    type: "CHAT",
    isActive: true,
    supportsImages: false,
    supportsTools: false,
    supportsStreaming: true,
    routerTier: "TIER_1",
    providerId: provider.id,
    provider,
  },
  {
    id: "large-model",
    modelId: "qwen-large",
    name: "Qwen Large",
    description: "Capable model",
    type: "CHAT",
    isActive: true,
    supportsImages: false,
    supportsTools: false,
    supportsStreaming: true,
    routerTier: "TIER_3",
    providerId: provider.id,
    provider,
  },
] as unknown as AIModel[];

describe("AutoRoutingConfigDialog", () => {
  it("explains Auto and uses Small/Large tier labels without exposing numeric names", () => {
    render(
      <AutoRoutingConfigDialog open onOpenChange={vi.fn()} models={models} onSave={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "Configure Auto models" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Small tier" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Large tier" })).toBeInTheDocument();
    expect(screen.getByText(/Auto evaluates each request/)).toBeInTheDocument();
    expect(screen.queryByText(/Tier [123]/)).not.toBeInTheDocument();
  });

  it("moves a model between the two groups and saves the selection", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AutoRoutingConfigDialog open onOpenChange={vi.fn()} models={models} onSave={onSave} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Qwen Small for large tier" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Auto models" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        smallModelIds: [],
        largeModelIds: ["large-model", "small-model"],
      });
    });
  });
});
