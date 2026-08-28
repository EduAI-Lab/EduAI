import { useCallback } from "react";
import { Link, useLoaderData, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AiModelsAdminView } from "~/components/admin/ai-models-admin-view";
import type { ModelFormData } from "~/components/admin/model-form-dialog";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import { useAiModels } from "~/hooks/api/use-ai-models";
import { useAiProviders } from "~/hooks/api/use-ai-providers";
import { useRoutingModelSettings } from "~/hooks/api/use-routing-model-settings";
import { useFleetConfig } from "~/hooks/api/use-fleet-config";
import { useAssistModelSetting } from "~/hooks/api/use-assist-model-setting";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

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
  const {
    providers,
    total: providersTotal,
    pagination: providersPagination,
    setPagination: setProvidersPagination,
    isLoading: providersLoading,
    error: providersError,
    refresh: refreshProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleProviderActive,
    // Providers also populate the model filter and form pickers, so load the
    // largest page the API allows rather than the default 25.
  } = useAiProviders({ pageSize: 200 });
  const {
    models,
    total: modelsTotal,
    pagination: modelsPagination,
    setPagination: setModelsPagination,
    search: modelSearch,
    setSearch: setModelSearch,
    providerId: modelProviderId,
    setProviderId: setModelProviderId,
    isLoading: modelsLoading,
    error: modelsError,
    createModel,
    updateModel,
    deleteModel,
    toggleModelActive,
  } = useAiModels();
  const {
    settings: routingModelSettings,
    definitions: routingModelDefinitions,
    isLoading: routingModelsLoading,
    error: routingModelsError,
    setEnabled: setRoutingModelEnabled,
  } = useRoutingModelSettings();
  const {
    servers: fleetServers,
    configured: fleetConfigured,
    source: fleetSource,
    isLoading: fleetConfigLoading,
    isSaving: fleetConfigSaving,
    error: fleetConfigError,
    save: saveFleetConfig,
  } = useFleetConfig();
  const {
    modelId: assistModelId,
    error: assistModelSettingError,
    save: saveAssistModel,
  } = useAssistModelSetting();

  const isLoading = providersLoading || modelsLoading || routingModelsLoading;
  const error = providersError ?? modelsError ?? routingModelsError ?? assistModelSettingError;

  const handleCreateModel = useCallback(
    async (data: ModelFormData) => {
      await createModel(data);
      await refreshProviders();
    },
    [createModel, refreshProviders],
  );

  const handleUpdateModel = useCallback(
    async (id: string, data: Partial<ModelFormData>) => {
      await updateModel(id, data);
      await refreshProviders();
    },
    [updateModel, refreshProviders],
  );

  const handleDeleteModel = useCallback(
    async (id: string) => {
      await deleteModel(id);
      await refreshProviders();
    },
    [deleteModel, refreshProviders],
  );

  return (
    <CoreAppShell
      user={user}
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/dashboard">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Admin</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>AI Models</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <AiModelsAdminView
        providers={providers}
        providersTotal={providersTotal}
        providersPagination={providersPagination}
        onProvidersPaginationChange={setProvidersPagination}
        models={models}
        modelsTotal={modelsTotal}
        modelsPagination={modelsPagination}
        onModelsPaginationChange={setModelsPagination}
        modelSearch={modelSearch}
        onModelSearchChange={setModelSearch}
        modelProviderId={modelProviderId}
        onModelProviderIdChange={setModelProviderId}
        isLoading={isLoading}
        error={error}
        onCreateProvider={createProvider}
        onUpdateProvider={updateProvider}
        onDeleteProvider={deleteProvider}
        onToggleProviderActive={toggleProviderActive}
        onCreateModel={handleCreateModel}
        onUpdateModel={handleUpdateModel}
        onDeleteModel={handleDeleteModel}
        onToggleModelActive={toggleModelActive}
        routingModelSettings={routingModelSettings}
        routingModelDefinitions={routingModelDefinitions}
        onToggleRoutingModel={setRoutingModelEnabled}
        assistModelId={assistModelId}
        onSetAssistModel={saveAssistModel}
        assistModelSettingError={assistModelSettingError}
        fleetServers={fleetServers}
        fleetConfigured={fleetConfigured}
        fleetSource={fleetSource}
        fleetConfigLoading={fleetConfigLoading}
        fleetConfigSaving={fleetConfigSaving}
        fleetConfigError={fleetConfigError}
        onSaveFleetConfig={saveFleetConfig}
      />
    </CoreAppShell>
  );
}
