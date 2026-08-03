/**
 * #1041: the models table is server-paginated, so the search box and provider
 * filter are lifted to props and resolved server-side. Filtering the loaded page
 * would only ever search that page, so what matters here is that a keystroke and
 * a provider choice are reported upward rather than handled locally.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { AiModelsAdminView } from "~/components/admin/ai-models-admin-view";
import type { AIModel, AIProvider } from "~/hooks/api/types";
import {
  defaultRoutingModelSettings,
  routingModelSettingDefinitions,
} from "~/lib/routing-model-settings";

const provider = {
  id: "prov-1",
  name: "openai",
  displayName: "OpenAI",
  isActive: true,
  requiresApiKey: true,
  _count: { models: 2 },
} as unknown as AIProvider;

const model = {
  id: "model-1",
  modelId: "gpt-test",
  name: "Test Model",
  isActive: true,
  providerId: "prov-1",
  provider,
  type: "CHAT",
} as unknown as AIModel;

function renderView(overrides: Partial<React.ComponentProps<typeof AiModelsAdminView>> = {}) {
  const onModelSearchChange = vi.fn();
  const onModelProviderIdChange = vi.fn();
  const onModelsPaginationChange = vi.fn();
  render(
    <MemoryRouter>
      <AiModelsAdminView
        providers={[provider]}
        providersTotal={1}
        providersPagination={{ pageIndex: 0, pageSize: 200 }}
        onProvidersPaginationChange={vi.fn()}
        models={[model]}
        modelsTotal={137}
        modelsPagination={{ pageIndex: 0, pageSize: 25 }}
        onModelsPaginationChange={onModelsPaginationChange}
        modelSearch=""
        onModelSearchChange={onModelSearchChange}
        modelProviderId={null}
        onModelProviderIdChange={onModelProviderIdChange}
        isLoading={false}
        error={null}
        onCreateProvider={vi.fn()}
        onUpdateProvider={vi.fn()}
        onDeleteProvider={vi.fn()}
        onToggleProviderActive={vi.fn()}
        onCreateModel={vi.fn()}
        onUpdateModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onToggleModelActive={vi.fn()}
        routingModelSettings={defaultRoutingModelSettings()}
        routingModelDefinitions={routingModelSettingDefinitions()}
        onToggleRoutingModel={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { onModelSearchChange, onModelProviderIdChange, onModelsPaginationChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AiModelsAdminView", () => {
  it("reports model search upward so it resolves server-side", () => {
    const { onModelSearchChange } = renderView();

    fireEvent.change(screen.getByPlaceholderText("Search models..."), {
      target: { value: "claude" },
    });

    // Not filtered locally — the page on screen is only one page of matches.
    expect(onModelSearchChange).toHaveBeenCalledWith("claude");
  });

  it("renders the search box as a controlled input from props", () => {
    renderView({ modelSearch: "gpt" });

    expect((screen.getByPlaceholderText("Search models...") as HTMLInputElement).value).toBe("gpt");
  });

  it("shows the server-reported model total rather than the loaded row count", () => {
    renderView();

    expect(screen.getAllByText(/137/).length).toBeGreaterThan(0);
  });

  it("surfaces the error message when a list read failed", () => {
    renderView({ error: "PAGINATION_REQUIRED" });

    expect(screen.getByText(/PAGINATION_REQUIRED/)).toBeInTheDocument();
  });
});
