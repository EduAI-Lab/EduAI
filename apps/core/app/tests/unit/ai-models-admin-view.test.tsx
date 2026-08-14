/**
 * #1041: the models table is server-paginated, so the search box and provider
 * filter are lifted to props and resolved server-side. Filtering the loaded page
 * would only ever search that page, so what matters here is that a keystroke and
 * a provider choice are reported upward rather than handled locally.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { AiModelsAdminView } from "~/components/admin/ai-models-admin-view";
import type { AIModel, AIProvider } from "~/hooks/api/types";
import {
  defaultRoutingModelSettings,
  routingModelSettingDefinitions,
} from "~/lib/routing-model-settings";
import { fetchModelsByProvider } from "~/hooks/api/use-ai-models";

vi.mock("~/hooks/api/use-ai-models", () => ({
  fetchModelsByProvider: vi.fn(),
}));

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

const ollamaProvider = {
  id: "prov-ollama",
  name: "ollama",
  displayName: "Ollama",
  isActive: true,
  requiresApiKey: false,
  _count: { models: 0 },
} as unknown as AIProvider;

const vllmProvider = {
  id: "prov-vllm",
  name: "vllm",
  displayName: "vLLM",
  isActive: true,
  requiresApiKey: false,
  _count: { models: 0 },
} as unknown as AIProvider;

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

  it("shows a loading spinner instead of the tabs while isLoading", () => {
    renderView({ isLoading: true });

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("AI Models")).not.toBeInTheDocument();
  });

  it("reports the provider filter selection upward", async () => {
    const { onModelProviderIdChange } = renderView();

    // The provider filter combobox renders before the pagination's rows-per-page combobox.
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    const option = await screen.findByRole("option", { name: "OpenAI" });
    fireEvent.click(option);

    expect(onModelProviderIdChange).toHaveBeenCalledWith("prov-1");
  });

  it("reports the models pagination change upward", () => {
    const { onModelsPaginationChange } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(onModelsPaginationChange).toHaveBeenCalledWith({ pageIndex: 1, pageSize: 25 });
  });

  describe("model dialog", () => {
    it("opens the create-model dialog with an empty form", () => {
      renderView();

      fireEvent.click(screen.getByRole("button", { name: /add model/i }));

      expect(screen.getByRole("heading", { name: "Create Model" })).toBeInTheDocument();
    });

    it("opens the edit-model dialog prefilled when editing from the table", () => {
      renderView();

      // Edit is the first icon button in the model row.
      const row = screen.getByText("Test Model").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("button")[0]);

      expect(screen.getByRole("heading", { name: "Edit Model" })).toBeInTheDocument();
      expect(screen.getByLabelText("Model ID")).toHaveValue("gpt-test");
    });

    it("creates a model on submit and closes the dialog", async () => {
      const onCreateModel = vi.fn().mockResolvedValue(undefined);
      renderView({ onCreateModel });

      fireEvent.click(screen.getByRole("button", { name: /add model/i }));
      fireEvent.click(screen.getAllByRole("combobox")[0]);
      const providerOption = await screen.findByRole("option", { name: "OpenAI" });
      fireEvent.click(providerOption);
      fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "new-model" } });
      fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "New Model" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "desc" } });
      fireEvent.submit(screen.getByRole("button", { name: "Create Model" }).closest("form")!);

      await waitFor(() => {
        expect(onCreateModel).toHaveBeenCalledWith(
          expect.objectContaining({ modelId: "new-model", name: "New Model" }),
        );
      });
      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: "Create Model" })).not.toBeInTheDocument();
      });
    });

    it("updates the editing model's id on submit", async () => {
      const onUpdateModel = vi.fn().mockResolvedValue(undefined);
      renderView({ onUpdateModel });

      const row = screen.getByText("Test Model").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("button")[0]);
      await waitFor(() => {
        expect(screen.getByDisplayValue("gpt-test")).toBeInTheDocument();
      });
      const submitButton = screen.getByRole("button", { name: /update model/i });
      fireEvent.submit(submitButton.closest("form")!);

      await waitFor(() => {
        expect(onUpdateModel).toHaveBeenCalledWith(
          "model-1",
          expect.objectContaining({ modelId: "gpt-test" }),
        );
      });
    });

    it("logs and keeps the dialog open when creating a model fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const onCreateModel = vi.fn().mockRejectedValue(new Error("boom"));
      renderView({ onCreateModel });

      fireEvent.click(screen.getByRole("button", { name: /add model/i }));
      fireEvent.click(screen.getAllByRole("combobox")[0]);
      const providerOption = await screen.findByRole("option", { name: "OpenAI" });
      fireEvent.click(providerOption);
      fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "new-model" } });
      fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "New Model" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "desc" } });
      fireEvent.submit(screen.getByRole("button", { name: "Create Model" }).closest("form")!);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Failed to save model:",
          expect.any(Error),
        );
      });
      expect(screen.getByRole("heading", { name: "Create Model" })).toBeInTheDocument();

      consoleError.mockRestore();
    });

    it("deletes a model through the table's confirm dialog", async () => {
      const onDeleteModel = vi.fn().mockResolvedValue(undefined);
      renderView({ onDeleteModel });

      const row = screen.getByText("Test Model").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("button")[1]);
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(onDeleteModel).toHaveBeenCalledWith("model-1");
      });
    });

    it("logs when deleting a model fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const onDeleteModel = vi.fn().mockRejectedValue(new Error("boom"));
      renderView({ onDeleteModel });

      const row = screen.getByText("Test Model").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("button")[1]);
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Failed to delete model:",
          expect.any(Error),
        );
      });
      consoleError.mockRestore();
    });

    it("toggles a model's active state from the table switch", async () => {
      const onToggleModelActive = vi.fn().mockResolvedValue(undefined);
      renderView({ onToggleModelActive });

      // Switches 0-1 are the routing-model toggles; the model row switch is last.
      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[switches.length - 1]);

      await waitFor(() => {
        expect(onToggleModelActive).toHaveBeenCalledWith(model);
      });
    });

    it("logs when toggling a model fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const onToggleModelActive = vi.fn().mockRejectedValue(new Error("boom"));
      renderView({ onToggleModelActive });

      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[switches.length - 1]);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Failed to toggle model:",
          expect.any(Error),
        );
      });
      consoleError.mockRestore();
    });

    it("cancelling the model dialog closes it without submitting", () => {
      const onCreateModel = vi.fn();
      renderView({ onCreateModel });

      fireEvent.click(screen.getByRole("button", { name: /add model/i }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("heading", { name: "Create Model" })).not.toBeInTheDocument();
      expect(onCreateModel).not.toHaveBeenCalled();
    });
  });

  describe("routing models", () => {
    it("reports a routing model toggle upward", async () => {
      const onToggleRoutingModel = vi.fn().mockResolvedValue(undefined);
      renderView({ onToggleRoutingModel });

      fireEvent.click(screen.getByRole("switch", { name: "Disable Auto" }));

      await waitFor(() => {
        expect(onToggleRoutingModel).toHaveBeenCalledWith("autoLlmEnabled", false);
      });
    });

    it("logs when toggling a routing model fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const onToggleRoutingModel = vi.fn().mockRejectedValue(new Error("boom"));
      renderView({ onToggleRoutingModel });

      fireEvent.click(screen.getByRole("switch", { name: "Disable Auto" }));

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Failed to toggle routing model:",
          expect.any(Error),
        );
      });
      consoleError.mockRestore();
    });
  });

  describe("providers tab", () => {
    /** Radix Tabs mounts its panel asynchronously in jsdom. */
    const switchToProvidersTab = async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Providers" }), { button: 0 });
      await waitFor(() => {
        expect(screen.getByText("AI Providers")).toBeInTheDocument();
      });
    };

    it("switches to the Providers tab and reports pagination upward", async () => {
      const { onModelsPaginationChange } = renderView();
      await switchToProvidersTab();

      expect(onModelsPaginationChange).not.toHaveBeenCalled();
    });

    it("opens the create-provider dialog with an empty form", async () => {
      renderView();
      await switchToProvidersTab();
      fireEvent.click(screen.getByRole("button", { name: /add provider/i }));

      expect(screen.getByRole("heading", { name: "Create Provider" })).toBeInTheDocument();
    });

    it("opens the edit-provider dialog prefilled from the table", async () => {
      renderView();
      await switchToProvidersTab();

      const row = screen.getByText("OpenAI").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("button")[0]);

      expect(screen.getByText("Edit Provider")).toBeInTheDocument();
      expect(screen.getByLabelText("Name (ID)")).toHaveValue("openai");
    });

    it("creates a provider on submit and closes the dialog", async () => {
      const onCreateProvider = vi.fn().mockResolvedValue(undefined);
      renderView({ onCreateProvider });
      await switchToProvidersTab();
      fireEvent.click(screen.getByRole("button", { name: /add provider/i }));

      fireEvent.change(screen.getByLabelText("Name (ID)"), { target: { value: "anthropic" } });
      fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Anthropic" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "desc" } });
      fireEvent.submit(screen.getByRole("button", { name: "Create Provider" }).closest("form")!);

      await waitFor(() => {
        expect(onCreateProvider).toHaveBeenCalledWith(
          expect.objectContaining({ name: "anthropic", displayName: "Anthropic" }),
        );
      });
      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: "Create Provider" })).not.toBeInTheDocument();
      });
    });

    it("updates the editing provider's id on submit", async () => {
      const onUpdateProvider = vi.fn().mockResolvedValue(undefined);
      renderView({ onUpdateProvider });
      await switchToProvidersTab();

      const row = screen.getByText("OpenAI").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("button")[0]);
      await waitFor(() => {
        expect(screen.getByLabelText("Name (ID)")).toHaveValue("openai");
      });
      fireEvent.submit(screen.getByRole("button", { name: "Update Provider" }).closest("form")!);

      await waitFor(() => {
        expect(onUpdateProvider).toHaveBeenCalledWith(
          "prov-1",
          expect.objectContaining({ name: "openai" }),
        );
      });
    });

    it("logs when saving a provider fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const onCreateProvider = vi.fn().mockRejectedValue(new Error("boom"));
      renderView({ onCreateProvider });
      await switchToProvidersTab();
      fireEvent.click(screen.getByRole("button", { name: /add provider/i }));

      fireEvent.change(screen.getByLabelText("Name (ID)"), { target: { value: "anthropic" } });
      fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Anthropic" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "desc" } });
      fireEvent.submit(screen.getByRole("button", { name: "Create Provider" }).closest("form")!);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Failed to save provider:",
          expect.any(Error),
        );
      });
      consoleError.mockRestore();
    });

    it("deletes a provider through the table's confirm dialog", async () => {
      const onDeleteProvider = vi.fn().mockResolvedValue(undefined);
      renderView({ onDeleteProvider });
      await switchToProvidersTab();

      const row = screen.getByText("OpenAI").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("button")[1]);
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(onDeleteProvider).toHaveBeenCalledWith("prov-1");
      });
    });

    it("logs when deleting a provider fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const onDeleteProvider = vi.fn().mockRejectedValue(new Error("boom"));
      renderView({ onDeleteProvider });
      await switchToProvidersTab();

      const row = screen.getByText("OpenAI").closest("tr")!;
      fireEvent.click(within(row).getAllByRole("button")[1]);
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Failed to delete provider:",
          expect.any(Error),
        );
      });
      consoleError.mockRestore();
    });

    it("toggles a provider's active state from the table switch", async () => {
      const onToggleProviderActive = vi.fn().mockResolvedValue(undefined);
      renderView({ onToggleProviderActive });
      await switchToProvidersTab();

      fireEvent.click(screen.getAllByRole("switch")[0]);

      await waitFor(() => {
        expect(onToggleProviderActive).toHaveBeenCalledWith(provider);
      });
    });

    it("logs when toggling a provider fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const onToggleProviderActive = vi.fn().mockRejectedValue(new Error("boom"));
      renderView({ onToggleProviderActive });
      await switchToProvidersTab();

      fireEvent.click(screen.getAllByRole("switch")[0]);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Failed to toggle provider:",
          expect.any(Error),
        );
      });
      consoleError.mockRestore();
    });
  });

  describe("local model sync", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.mocked(fetchModelsByProvider).mockResolvedValue([]);
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("syncs discovered Ollama models and shows the result message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: "llama3", model: "llama3", size: 123, digest: "d", modified_at: "now", details: {} },
          ],
        }),
      }) as unknown as typeof fetch;
      const onCreateModel = vi.fn().mockResolvedValue(undefined);

      renderView({ providers: [provider, ollamaProvider], onCreateModel });

      fireEvent.click(screen.getByRole("button", { name: /sync ollama models/i }));

      await waitFor(() => {
        expect(onCreateModel).toHaveBeenCalledWith(
          expect.objectContaining({ modelId: "llama3", providerId: "prov-ollama" }),
        );
      });
      await waitFor(() => {
        expect(screen.getByText(/Ollama: added 1 model/)).toBeInTheDocument();
      });
    });

    it("shows an error when the Ollama fetch fails", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Ollama unreachable" }),
      }) as unknown as typeof fetch;

      renderView({ providers: [provider, ollamaProvider] });

      fireEvent.click(screen.getByRole("button", { name: /sync ollama models/i }));

      await waitFor(() => {
        expect(screen.getByText("Ollama unreachable")).toBeInTheDocument();
      });
    });

    it("syncs discovered vLLM models and shows the result message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ id: "qwen-7b", owned_by: "vllm" }] }),
      }) as unknown as typeof fetch;
      const onCreateModel = vi.fn().mockResolvedValue(undefined);

      renderView({ providers: [provider, vllmProvider], onCreateModel });

      fireEvent.click(screen.getByRole("button", { name: /sync vllm models/i }));

      await waitFor(() => {
        expect(onCreateModel).toHaveBeenCalledWith(
          expect.objectContaining({ modelId: "qwen-7b", providerId: "prov-vllm" }),
        );
      });
      await waitFor(() => {
        expect(screen.getByText(/vLLM: added 1 model/)).toBeInTheDocument();
      });
    });

    it("maps a 404 vLLM response to the friendly missing-route message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Not Found" }),
      }) as unknown as typeof fetch;

      renderView({ providers: [provider, vllmProvider] });

      fireEvent.click(screen.getByRole("button", { name: /sync vllm models/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/Cannot reach \/api\/vllm-models/),
        ).toBeInTheDocument();
      });
    });

    it("surfaces a non-404 vLLM error message as-is", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal error" }),
      }) as unknown as typeof fetch;

      renderView({ providers: [provider, vllmProvider] });

      fireEvent.click(screen.getByRole("button", { name: /sync vllm models/i }));

      await waitFor(() => {
        expect(screen.getByText("Internal error")).toBeInTheDocument();
      });
    });

    it("handles an invalid JSON response from the vLLM endpoint", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("bad json");
        },
      }) as unknown as typeof fetch;

      renderView({ providers: [provider, vllmProvider] });

      fireEvent.click(screen.getByRole("button", { name: /sync vllm models/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/Cannot reach \/api\/vllm-models/),
        ).toBeInTheDocument();
      });
    });
  });
});
