import { useState, useEffect } from "react";
import { useLoaderData, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { IconPlus, IconSearch, IconFilter } from "@tabler/icons-react";

import { auth } from "~/lib/auth/server";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

import { AIModelsTable } from "~/components/admin/ai-models-table";
import { ModelFormDialog } from "~/components/admin/model-form-dialog";
import type { OllamaModel } from "~/components/admin/model-form-dialog";
import { ProvidersTable } from "~/components/admin/providers-table";
import { ProviderFormDialog } from "~/components/admin/provider-form-dialog";
import type { AIProvider, AIModel } from "../types/ai";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  if (session.user.role !== "ADMIN") {
    return redirect("/dashboard");
  }

  return {
    user: session.user,
  };
}

export default function AIModelsPage() {
  const { user } = useLoaderData<typeof loader>();
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");

  // Dialog states
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);

  // Ollama fetch state (owned here, passed as props to ModelFormDialog)
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [fetchingOllamaModels, setFetchingOllamaModels] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  // Fetch data
  const fetchProviders = async () => {
    try {
      const response = await fetch("/api/ai-providers");
      if (response.ok) {
        let data: AIProvider[] = await response.json();
        // Ensure _count is always present
        data = data.map((provider) => ({
          ...provider,
          _count: provider._count ?? { models: 0 },
        }));
        setProviders(data);
      }
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  };

  const fetchModels = async () => {
    try {
      const response = await fetch("/api/ai-models");
      if (response.ok) {
        const data: AIModel[] = await response.json();
        setModels(data);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([fetchProviders(), fetchModels()]);
      setLoading(false);
    };
    loadData();
  }, []);

  // Provider CRUD operations
  const handleCreateProvider = async (data: any) => {
    try {
      const response = await fetch("/api/ai-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        await fetchProviders();
        setProviderDialogOpen(false);
        setEditingProvider(null);
      }
    } catch (error) {
      console.error("Failed to create provider:", error);
    }
  };

  const handleUpdateProvider = async (data: any) => {
    if (!editingProvider) return;

    try {
      const response = await fetch(`/api/ai-providers/${editingProvider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        await fetchProviders();
        setProviderDialogOpen(false);
        setEditingProvider(null);
      }
    } catch (error) {
      console.error("Failed to update provider:", error);
    }
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      const response = await fetch(`/api/ai-providers/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchProviders();
      }
    } catch (error) {
      console.error("Failed to delete provider:", error);
    }
  };

  const handleToggleProvider = async (provider: AIProvider) => {
    try {
      const response = await fetch(`/api/ai-providers/${provider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !provider.isActive }),
      });

      if (response.ok) {
        await fetchProviders();
      }
    } catch (error) {
      console.error("Failed to toggle provider:", error);
    }
  };

  const fetchOllamaModels = async () => {
    setFetchingOllamaModels(true);
    setOllamaError(null);
    try {
      const response = await fetch("/api/ollama-models");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch Ollama models");
      setOllamaModels(data.models || []);
    } catch (error: any) {
      setOllamaError(error.message || "Failed to fetch Ollama models");
      setOllamaModels([]);
    } finally {
      setFetchingOllamaModels(false);
    }
  };

  const closeModelDialog = (open: boolean) => {
    setModelDialogOpen(open);
    if (!open) {
      setOllamaModels([]);
      setOllamaError(null);
    }
  };

  // Model CRUD operations
  const handleCreateModel = async (data: any) => {
    try {
      const response = await fetch("/api/ai-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        await Promise.all([fetchModels(), fetchProviders()]);
        closeModelDialog(false);
        setEditingModel(null);
      }
    } catch (error) {
      console.error("Failed to create model:", error);
    }
  };

  const handleUpdateModel = async (data: any) => {
    if (!editingModel) return;

    try {
      const response = await fetch(`/api/ai-models/${editingModel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        await Promise.all([fetchModels(), fetchProviders()]);
        closeModelDialog(false);
        setEditingModel(null);
      }
    } catch (error) {
      console.error("Failed to update model:", error);
    }
  };

  const handleDeleteModel = async (id: string) => {
    try {
      const response = await fetch(`/api/ai-models/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await Promise.all([fetchModels(), fetchProviders()]);
      }
    } catch (error) {
      console.error("Failed to delete model:", error);
    }
  };

  const handleToggleModel = async (model: AIModel) => {
    try {
      const response = await fetch(`/api/ai-models/${model.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !model.isActive }),
      });

      if (response.ok) {
        await fetchModels();
      }
    } catch (error) {
      console.error("Failed to toggle model:", error);
    }
  };

  // Filter models
  const filteredModels = models.filter(model => {
    const matchesSearch = model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         model.modelId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesProvider = selectedProvider === "all" || model.provider.name === selectedProvider;
    return matchesSearch && matchesProvider;
  });

  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar variant="inset" user={user} />
        <SidebarInset>
          <SiteHeader user={user} />
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader user={user} />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">AI Management</h2>
                    <p className="text-muted-foreground">
                      Manage AI providers and models for your platform
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-4 lg:px-6">
                <Tabs defaultValue="models" className="w-full">
            <TabsList>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="providers">Providers</TabsTrigger>
            </TabsList>

            <TabsContent value="models" className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>AI Models</CardTitle>
                      <CardDescription>
                        Manage AI models across all providers
                      </CardDescription>
                    </div>
                    <Button onClick={() => {
                      setEditingModel(null);
                      closeModelDialog(true);
                    }}>
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

                    <Select value={selectedProvider} onValueChange={setSelectedProvider}>
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
                      closeModelDialog(true);
                    }}
                    onDelete={handleDeleteModel}
                    onToggleActive={handleToggleModel}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="providers" className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>AI Providers</CardTitle>
                      <CardDescription>
                        Manage AI service providers and their configurations
                      </CardDescription>
                    </div>
                    <Button onClick={() => {
                      setEditingProvider(null);
                      setProviderDialogOpen(true);
                    }}>
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
                              </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>

          {/* Dialogs */}
          <ModelFormDialog
            open={modelDialogOpen}
            onOpenChange={closeModelDialog}
            model={editingModel}
            providers={providers}
            onSubmit={editingModel ? handleUpdateModel : handleCreateModel}
            ollamaModels={ollamaModels}
            fetchingOllamaModels={fetchingOllamaModels}
            ollamaError={ollamaError}
            onFetchOllamaModels={fetchOllamaModels}
          />

          <ProviderFormDialog
            open={providerDialogOpen}
            onOpenChange={setProviderDialogOpen}
            provider={editingProvider ? { ...editingProvider, models: undefined } : editingProvider}
            onSubmit={editingProvider ? handleUpdateProvider : handleCreateProvider}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}