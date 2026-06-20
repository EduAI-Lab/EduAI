import { useCallback, useMemo, useState } from "react";
import { IconFilter, IconPlus, IconSearch } from "@tabler/icons-react";

import { AIModelsTable } from "~/components/admin/ai-models-table";
import { ModelFormDialog } from "~/components/admin/model-form-dialog";
import { ProviderFormDialog } from "~/components/admin/provider-form-dialog";
import { ProvidersTable } from "~/components/admin/providers-table";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { PageHeading } from "@eduai/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";
import { PageTabs, PageTabsList, PageTabsTrigger, PageTabsContent } from "@eduai/ui";
import type { AIModel, AIProvider } from "~/hooks/api/types";
import type { OllamaModel, VllmModel } from "~/components/admin/model-form-dialog";

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
  models: AIModel[];
  isLoading: boolean;
  error: string | null;
  onCreateProvider: (data: Record<string, unknown>) => Promise<void>;
  onUpdateProvider: (id: string, data: Record<string, unknown>) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  onToggleProviderActive: (provider: AIProvider) => Promise<void>;
  onCreateModel: (data: Record<string, unknown>) => Promise<void>;
  onUpdateModel: (id: string, data: Record<string, unknown>) => Promise<void>;
  onDeleteModel: (id: string) => Promise<void>;
  onToggleModelActive: (model: AIModel) => Promise<void>;
};

export function AiModelsAdminView({
  providers,
  models,
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
}: AiModelsAdminViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("all");
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

  // Web tools are now governed by the chat.webToolsEnabled policy flag and
  // render automatically under Admin → Settings (see policy.server.ts).

  const handleFetchOllamaModels = useCallback(async () => {
    setFetchingOllamaModels(true);
    setOllamaError(null);
    try {
      const res = await fetch("/api/ollama-models");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch Ollama models");
      setOllamaModels(data.models ?? []);
    } catch (err) {
      setOllamaError(err instanceof Error ? err.message : "Failed to fetch Ollama models");
    } finally {
      setFetchingOllamaModels(false);
    }
  }, []);

  const handleFetchVllmModels = useCallback(async () => {
    setFetchingVllmModels(true);
    setVllmError(null);
    setVllmFetched(false);
    try {
      const res = await fetch("/api/vllm-models");
      let data: { error?: string; models?: VllmModel[] } = {};
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
      setVllmModels(data.models ?? []);
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
  }, []);

  const handleModelDialogChange = useCallback((open: boolean) => {
    setModelDialogOpen(open);
    if (!open) {
      setOllamaModels([]);
      setOllamaError(null);
      setVllmModels([]);
      setVllmError(null);
      setVllmFetched(false);
    }
  }, []);

  const filteredModels = useMemo(
    () =>
      models.filter((model) => {
        const matchesSearch =
          model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          model.modelId.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesProvider =
          selectedProvider === "all" || model.provider.name === selectedProvider;
        return matchesSearch && matchesProvider;
      }),
    [models, searchTerm, selectedProvider],
  );

  const handleProviderSubmit = async (data: Record<string, unknown>) => {
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

  const handleModelSubmit = async (data: Record<string, unknown>) => {
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
              </PageTabsList>

              <PageTabsContent value="models" className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>AI Models</CardTitle>
                        <CardDescription>
                          Manage AI models across all providers
                        </CardDescription>
                      </div>
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
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="relative flex-1 max-w-sm">
                        <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Search models..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                        />
                      </div>

                      <Select
                        value={selectedProvider}
                        onValueChange={setSelectedProvider}
                      >
                        <SelectTrigger className="w-48">
                          <IconFilter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Providers</SelectItem>
                          {providers.map((provider) => (
                            <SelectItem key={provider.id} value={provider.name}>
                              {provider.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <AIModelsTable
                      models={filteredModels}
                      onEdit={(model) => {
                        setEditingModel(model);
                        handleModelDialogChange(true);
                      }}
                      onDelete={handleDeleteModel}
                      onToggleActive={handleToggleModel}
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
                  </CardContent>
                </Card>
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
        onFetchOllamaModels={handleFetchOllamaModels}
        vllmModels={vllmModels}
        fetchingVllmModels={fetchingVllmModels}
        vllmError={vllmError}
        vllmFetched={vllmFetched}
        onFetchVllmModels={handleFetchVllmModels}
      />

      <ProviderFormDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        provider={
          editingProvider ? { ...editingProvider, models: undefined } : editingProvider
        }
        onSubmit={handleProviderSubmit}
      />
    </div>
  );
}
