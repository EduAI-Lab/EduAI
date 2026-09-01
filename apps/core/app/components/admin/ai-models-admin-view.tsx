import { useCallback, useMemo, useState } from "react";
import { IconFilter, IconPlus, IconSearch } from "@tabler/icons-react";

import { AIModelsTable } from "~/components/admin/ai-models-table";
import {
  AutoRoutingConfigDialog,
  type AutoRoutingSelection,
} from "~/components/admin/auto-routing-config-dialog";
import { AssistModelConfigDialog } from "~/components/admin/assist-model-config-dialog";
import { ModelFormDialog } from "~/components/admin/model-form-dialog";
import { ProviderFormDialog } from "~/components/admin/provider-form-dialog";
import { ProvidersTable } from "~/components/admin/providers-table";
import { RoutingModelsTable } from "~/components/admin/routing-models-table";
import { FleetConfigPanel } from "~/components/admin/fleet-config-panel";
import { TablePagination } from "~/components/ui/table-pagination";
import { fetchAllModels, fetchModelsByProvider } from "~/hooks/api/use-ai-models";
import type { PaginationState } from "~/hooks/api/pagination";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { PageHeading } from "@eduai/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eduai/ui";
import { PageTabs, PageTabsList, PageTabsTrigger, PageTabsContent } from "@eduai/ui";
import type { AIModel, AIProvider } from "~/hooks/api/types";
import type { ModelFormData, OllamaModel, VllmModel } from "~/components/admin/model-form-dialog";
import type { ProviderFormData } from "~/components/admin/provider-form-dialog";
import type { RoutingModelSettingDefinition } from "~/hooks/api/use-routing-model-settings";
import type { RoutingModelSettingKey, RoutingModelSettings } from "~/lib/routing-model-settings";
import type { FleetConnectionTest, FleetServerConfig } from "~/hooks/api/use-fleet-config";
import {
  buildOllamaModelCreatePayload,
  buildVllmModelCreatePayload,
  formatLocalModelSyncMessage,
  syncLocalModels,
  type LocalModelCreatePayload,
} from "~/lib/ai/local-model-sync";

/** What `GET /api/vllm-models` answers with: the discovered models, or why not. */
type VllmModelsResponse = { error?: string; models?: VllmModel[] };

function isVllmFetchNotFound(message: string, httpStatus?: number): boolean {
  return (
    httpStatus === 404 ||
    message.includes("404") ||
    message.includes("Not Found") ||
    message.includes("/api/vllm-models is missing")
  );
}

export type AiModelsAdminViewProps = {
  providers: AIProvider[];
  providersTotal: number;
  providersPagination: PaginationState;
  onProvidersPaginationChange: (next: PaginationState) => void;
  models: AIModel[];
  modelsTotal: number;
  modelsPagination: PaginationState;
  onModelsPaginationChange: (next: PaginationState) => void;
  /** Model search text; resolved server-side (#1041). */
  modelSearch: string;
  onModelSearchChange: (next: string) => void;
  /** Provider filter, by id; `null` means all providers. */
  modelProviderId: string | null;
  onModelProviderIdChange: (next: string | null) => void;
  isLoading: boolean;
  error: string | null;
  onCreateProvider: (data: ProviderFormData) => Promise<void>;
  onUpdateProvider: (id: string, data: ProviderFormData) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  onToggleProviderActive: (provider: AIProvider) => Promise<void>;
  onCreateModel: (data: ModelFormData) => Promise<void>;
  onUpdateModel: (id: string, data: Partial<ModelFormData>) => Promise<void>;
  onDeleteModel: (id: string) => Promise<void>;
  onToggleModelActive: (model: AIModel) => Promise<void>;
  routingModelSettings: RoutingModelSettings;
  routingModelDefinitions: RoutingModelSettingDefinition[];
  onToggleRoutingModel: (key: RoutingModelSettingKey, value: boolean) => Promise<void>;
  assistModelId: string | null;
  onSetAssistModel: (modelId: string | null) => Promise<string | null>;
  assistModelSettingError: string | null;
  fleetServers: FleetServerConfig[];
  fleetConnectionTest: FleetConnectionTest | null;
  fleetConfigured: boolean;
  fleetSource: "file" | "environment";
  fleetConfigLoading: boolean;
  fleetConfigSaving: boolean;
  fleetConfigError: string | null;
  onSaveFleetConfig: (servers: FleetServerConfig[]) => Promise<FleetServerConfig[]>;
};

export function AiModelsAdminView({
  providers,
  providersTotal,
  providersPagination,
  onProvidersPaginationChange,
  models,
  modelsTotal,
  modelsPagination,
  onModelsPaginationChange,
  modelSearch,
  onModelSearchChange,
  modelProviderId,
  onModelProviderIdChange,
  isLoading,
  error,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
  onToggleProviderActive,
  onCreateModel,
  onUpdateModel,
  onDeleteModel,
  onToggleModelActive,
  routingModelSettings,
  routingModelDefinitions,
  onToggleRoutingModel,
  assistModelId,
  onSetAssistModel,
  assistModelSettingError,
  fleetServers,
  fleetConnectionTest,
  fleetConfigured,
  fleetSource,
  fleetConfigLoading,
  fleetConfigSaving,
  fleetConfigError,
  onSaveFleetConfig,
}: AiModelsAdminViewProps) {
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [fetchingOllamaModels, setFetchingOllamaModels] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [vllmModels, setVllmModels] = useState<VllmModel[]>([]);
  const [fetchingVllmModels, setFetchingVllmModels] = useState(false);
  const [vllmError, setVllmError] = useState<string | null>(null);
  const [vllmFetched, setVllmFetched] = useState(false);
  const [ollamaFetched, setOllamaFetched] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<"ollama" | "vllm" | null>(null);
  const [autoRoutingDialogOpen, setAutoRoutingDialogOpen] = useState(false);
  const [autoRoutingModels, setAutoRoutingModels] = useState<AIModel[]>([]);
  const [fetchingAutoRoutingModels, setFetchingAutoRoutingModels] = useState(false);
  const [autoRoutingError, setAutoRoutingError] = useState<string | null>(null);
  const [assistModelDialogOpen, setAssistModelDialogOpen] = useState(false);
  const [assistModels, setAssistModels] = useState<AIModel[]>([]);
  const [fetchingAssistModels, setFetchingAssistModels] = useState(false);
  const [assistModelsError, setAssistModelsError] = useState<string | null>(null);

  const ollamaProvider = useMemo(
    () => providers.find((provider) => provider.name === "ollama" && provider.isActive),
    [providers],
  );
  const vllmProvider = useMemo(
    () => providers.find((provider) => provider.name === "vllm" && provider.isActive),
    [providers],
  );

  const registerDiscoveredModels = useCallback(
    async (provider: AIProvider, providerLabel: string, payloads: LocalModelCreatePayload[]) => {
      // Dedupe against the provider's full model set, not the page on screen.
      const existing = await fetchModelsByProvider(provider.id);
      const result = await syncLocalModels(existing, provider.id, payloads, onCreateModel);
      setSyncMessage(formatLocalModelSyncMessage(providerLabel, result));
      return result;
    },
    [onCreateModel],
  );

  const handleFetchOllamaModels = useCallback(
    async (options?: { autoRegister?: boolean }) => {
      setFetchingOllamaModels(true);
      setOllamaError(null);
      setOllamaFetched(false);
      try {
        const res = await fetch("/api/ollama-models");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to fetch Ollama models");
        const discovered = data.models ?? [];
        setOllamaModels(discovered);

        if (options?.autoRegister !== false && ollamaProvider && discovered.length > 0) {
          await registerDiscoveredModels(
            ollamaProvider,
            "Ollama",
            discovered.map(buildOllamaModelCreatePayload),
          );
        }
      } catch (err) {
        setOllamaError(err instanceof Error ? err.message : "Failed to fetch Ollama models");
        setOllamaModels([]);
      } finally {
        setFetchingOllamaModels(false);
        setOllamaFetched(true);
      }
    },
    [ollamaProvider, registerDiscoveredModels],
  );

  const handleFetchVllmModels = useCallback(
    async (options?: { autoRegister?: boolean }) => {
      setFetchingVllmModels(true);
      setVllmError(null);
      setVllmFetched(false);
      try {
        const res = await fetch("/api/vllm-models");
        let data: VllmModelsResponse = {};
        try {
          data = await res.json();
        } catch {
          throw new Error(
            `Invalid response from server (HTTP ${res.status}). Restart dev server if /api/vllm-models is missing.`,
          );
        }
        if (!res.ok) {
          const err = new Error(
            data.error ?? `Failed to fetch vLLM models (HTTP ${res.status})`,
          ) as Error & { httpStatus?: number };
          err.httpStatus = res.status;
          throw err;
        }
        const discovered = data.models ?? [];
        setVllmModels(discovered);

        if (options?.autoRegister !== false && vllmProvider && discovered.length > 0) {
          await registerDiscoveredModels(
            vllmProvider,
            "vLLM",
            discovered.map(buildVllmModelCreatePayload),
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to fetch vLLM models";
        const httpStatus = (err as { httpStatus?: number }).httpStatus;
        if (isVllmFetchNotFound(message, httpStatus)) {
          setVllmError(
            "Cannot reach /api/vllm-models — pull latest feat/VLLM and restart the EduAI dev server.",
          );
        } else {
          setVllmError(message);
        }
        setVllmModels([]);
      } finally {
        setFetchingVllmModels(false);
        setVllmFetched(true);
      }
    },
    [registerDiscoveredModels, vllmProvider],
  );

  const handleSyncOllamaFromTab = useCallback(async () => {
    if (!ollamaProvider) {
      setSyncMessage("Enable the Ollama provider first under Settings → Providers.");
      return;
    }
    setSyncingProvider("ollama");
    setSyncMessage(null);
    await handleFetchOllamaModels();
    setSyncingProvider(null);
  }, [handleFetchOllamaModels, ollamaProvider]);

  const handleSyncVllmFromTab = useCallback(async () => {
    if (!vllmProvider) {
      setSyncMessage("Enable the vLLM provider first under Settings → Providers.");
      return;
    }
    setSyncingProvider("vllm");
    setSyncMessage(null);
    await handleFetchVllmModels();
    setSyncingProvider(null);
  }, [handleFetchVllmModels, vllmProvider]);

  const handleModelDialogChange = useCallback((open: boolean) => {
    setModelDialogOpen(open);
    if (!open) {
      setOllamaModels([]);
      setOllamaError(null);
      setOllamaFetched(false);
      setVllmModels([]);
      setVllmError(null);
      setVllmFetched(false);
    }
  }, []);

  const handleProviderSubmit = async (data: ProviderFormData) => {
    try {
      if (editingProvider) {
        await onUpdateProvider(editingProvider.id, data);
      } else {
        await onCreateProvider(data);
      }
      setProviderDialogOpen(false);
      setEditingProvider(null);
    } catch (err) {
      console.error("Failed to save provider:", err);
    }
  };

  const handleModelSubmit = async (data: ModelFormData) => {
    try {
      if (editingModel) {
        await onUpdateModel(editingModel.id, data);
      } else {
        await onCreateModel(data);
      }
      setModelDialogOpen(false);
      setEditingModel(null);
    } catch (err) {
      console.error("Failed to save model:", err);
    }
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      await onDeleteProvider(id);
    } catch (err) {
      console.error("Failed to delete provider:", err);
    }
  };

  const handleDeleteModel = async (id: string) => {
    try {
      await onDeleteModel(id);
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  };

  const handleToggleProvider = async (provider: AIProvider) => {
    try {
      await onToggleProviderActive(provider);
    } catch (err) {
      console.error("Failed to toggle provider:", err);
    }
  };

  const handleToggleModel = async (model: AIModel) => {
    try {
      await onToggleModelActive(model);
    } catch (err) {
      console.error("Failed to toggle model:", err);
    }
  };

  const handleToggleRoutingModel = async (key: RoutingModelSettingKey, value: boolean) => {
    try {
      await onToggleRoutingModel(key, value);
    } catch (err) {
      console.error("Failed to toggle routing model:", err);
    }
  };

  const handleEditAutoRouting = async () => {
    setAutoRoutingDialogOpen(true);
    setFetchingAutoRoutingModels(true);
    setAutoRoutingError(null);
    try {
      setAutoRoutingModels(await fetchAllModels());
    } catch (err) {
      setAutoRoutingError(
        err instanceof Error ? err.message : "Failed to load models for Auto routing",
      );
    } finally {
      setFetchingAutoRoutingModels(false);
    }
  };

  const handleEditAssistModel = async () => {
    setAssistModelDialogOpen(true);
    setFetchingAssistModels(true);
    setAssistModelsError(null);
    try {
      setAssistModels(await fetchAllModels());
    } catch (err) {
      setAssistModelsError(
        err instanceof Error ? err.message : "Failed to load models for AI Assist",
      );
    } finally {
      setFetchingAssistModels(false);
    }
  };

  const assistModel = assistModels.find(
    (model) => `${model.provider.name}:${model.modelId}` === assistModelId,
  );
  const assistModelName = assistModel?.name ?? null;
  const fleetModelLocations = useMemo(() => {
    const locations = new Map<string, Set<string>>();
    const addLocation = (serverId: string, modelId: string) => {
      const key = `vllm:${modelId.toLowerCase()}`;
      const serverIds = locations.get(key) ?? new Set<string>();
      serverIds.add(serverId);
      locations.set(key, serverIds);
    };

    for (const server of fleetServers) {
      for (const modelId of server.models) addLocation(server.id, modelId);
    }
    for (const server of fleetConnectionTest?.servers ?? []) {
      for (const modelId of server.models) addLocation(server.serverId, modelId);
    }

    return Object.fromEntries(
      [...locations.entries()].map(([modelId, serverIds]) => [modelId, [...serverIds]]),
    );
  }, [fleetConnectionTest, fleetServers]);

  const handleSaveAutoRouting = async ({ smallModelIds, largeModelIds }: AutoRoutingSelection) => {
    const small = new Set(smallModelIds);
    const large = new Set(largeModelIds);

    for (const model of autoRoutingModels) {
      if (model.type !== "CHAT") continue;
      const routerTier = small.has(model.id) ? "TIER_1" : large.has(model.id) ? "TIER_3" : null;
      if (model.routerTier !== routerTier) {
        await onUpdateModel(model.id, { routerTier });
      }
    }

    setAutoRoutingModels((current) =>
      current.map((model) => {
        if (model.type !== "CHAT") return model;
        return {
          ...model,
          routerTier: small.has(model.id) ? "TIER_1" : large.has(model.id) ? "TIER_3" : null,
        };
      }),
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <PageHeading
              heading="AI management"
              subheading="Manage AI providers and models for your platform"
            />
          </div>

          {error && (
            <div className="px-4 lg:px-6">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="px-4 lg:px-6">
            <PageTabs defaultValue="models" className="w-full">
              <PageTabsList>
                <PageTabsTrigger value="models">Models</PageTabsTrigger>
                <PageTabsTrigger value="providers">Providers</PageTabsTrigger>
                <PageTabsTrigger value="servers">Servers</PageTabsTrigger>
              </PageTabsList>

              <PageTabsContent value="models" className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>AI Models</CardTitle>
                        <CardDescription>Manage AI models across all providers</CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {ollamaProvider && (
                          <Button
                            variant="outline"
                            onClick={() => void handleSyncOllamaFromTab()}
                            disabled={syncingProvider !== null}
                          >
                            {syncingProvider === "ollama"
                              ? "Syncing Ollama…"
                              : "Sync Ollama models"}
                          </Button>
                        )}
                        {vllmProvider && (
                          <Button
                            variant="outline"
                            onClick={() => void handleSyncVllmFromTab()}
                            disabled={syncingProvider !== null}
                          >
                            {syncingProvider === "vllm" ? "Syncing vLLM…" : "Sync vLLM models"}
                          </Button>
                        )}
                        <Button
                          onClick={() => {
                            setEditingModel(null);
                            handleModelDialogChange(true);
                          }}
                        >
                          <IconPlus className="h-4 w-4 mr-2" />
                          Add Model
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <RoutingModelsTable
                      definitions={routingModelDefinitions}
                      settings={routingModelSettings}
                      assistModelId={assistModelId}
                      assistModelName={assistModelName}
                      onToggle={handleToggleRoutingModel}
                      onEdit={() => void handleEditAutoRouting()}
                      onEditAssist={() => void handleEditAssistModel()}
                    />

                    {(syncMessage || ollamaError || vllmError) && (
                      <div className="space-y-2">
                        {syncMessage && (
                          <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/40 px-3 py-2">
                            {syncMessage}
                          </p>
                        )}
                        {ollamaError && !modelDialogOpen && (
                          <p className="text-sm text-destructive">{ollamaError}</p>
                        )}
                        {vllmError && !modelDialogOpen && (
                          <p className="text-sm text-destructive">{vllmError}</p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-4">
                      <div className="relative flex-1 max-w-sm">
                        <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          aria-label="Search models"
                          placeholder="Search models..."
                          value={modelSearch}
                          onChange={(e) => onModelSearchChange(e.target.value)}
                          className="pl-10"
                        />
                      </div>

                      <Select
                        value={modelProviderId ?? "all"}
                        onValueChange={(value) =>
                          onModelProviderIdChange(value === "all" ? null : value)
                        }
                      >
                        <SelectTrigger className="w-48" aria-label="Filter models by provider">
                          <IconFilter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Providers</SelectItem>
                          {providers.map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                              {provider.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <AIModelsTable
                      models={models}
                      fleetModelLocations={fleetModelLocations}
                      onEdit={(model) => {
                        setEditingModel(model);
                        handleModelDialogChange(true);
                      }}
                      onDelete={handleDeleteModel}
                      onToggleActive={handleToggleModel}
                    />
                    <TablePagination
                      pagination={modelsPagination}
                      onPaginationChange={onModelsPaginationChange}
                      total={modelsTotal}
                    />
                  </CardContent>
                </Card>
              </PageTabsContent>

              <PageTabsContent value="providers" className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>AI Providers</CardTitle>
                        <CardDescription>
                          Manage AI service providers and their configurations
                        </CardDescription>
                      </div>
                      <Button
                        onClick={() => {
                          setEditingProvider(null);
                          setProviderDialogOpen(true);
                        }}
                      >
                        <IconPlus className="h-4 w-4 mr-2" />
                        Add Provider
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ProvidersTable
                      providers={providers}
                      onEdit={(provider) => {
                        setEditingProvider(provider);
                        setProviderDialogOpen(true);
                      }}
                      onDelete={handleDeleteProvider}
                      onToggleActive={handleToggleProvider}
                    />
                    <TablePagination
                      pagination={providersPagination}
                      onPaginationChange={onProvidersPaginationChange}
                      total={providersTotal}
                    />
                  </CardContent>
                </Card>
              </PageTabsContent>

              <PageTabsContent value="servers" className="space-y-4">
                <FleetConfigPanel
                  servers={fleetServers}
                  configured={fleetConfigured}
                  source={fleetSource}
                  loading={fleetConfigLoading}
                  saving={fleetConfigSaving}
                  error={fleetConfigError}
                  connectionTest={fleetConnectionTest}
                  onSave={onSaveFleetConfig}
                />
              </PageTabsContent>
            </PageTabs>
          </div>
        </div>
      </div>

      <ModelFormDialog
        open={modelDialogOpen}
        onOpenChange={handleModelDialogChange}
        model={editingModel}
        providers={providers}
        onSubmit={handleModelSubmit}
        ollamaModels={ollamaModels}
        fetchingOllamaModels={fetchingOllamaModels}
        ollamaError={ollamaError}
        ollamaFetched={ollamaFetched}
        onFetchOllamaModels={() => void handleFetchOllamaModels()}
        vllmModels={vllmModels}
        fetchingVllmModels={fetchingVllmModels}
        vllmError={vllmError}
        vllmFetched={vllmFetched}
        onFetchVllmModels={() => void handleFetchVllmModels()}
        syncMessage={syncMessage}
      />

      <AutoRoutingConfigDialog
        open={autoRoutingDialogOpen}
        onOpenChange={setAutoRoutingDialogOpen}
        models={autoRoutingModels}
        loading={fetchingAutoRoutingModels}
        error={autoRoutingError}
        onSave={handleSaveAutoRouting}
      />

      <AssistModelConfigDialog
        open={assistModelDialogOpen}
        onOpenChange={setAssistModelDialogOpen}
        models={assistModels}
        selectedModelId={assistModelId}
        loading={fetchingAssistModels}
        error={assistModelSettingError ?? assistModelsError}
        onSave={async (modelId) => {
          await onSetAssistModel(modelId);
        }}
      />

      <ProviderFormDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        provider={editingProvider ? { ...editingProvider, models: undefined } : editingProvider}
        onSubmit={handleProviderSubmit}
      />
    </div>
  );
}
