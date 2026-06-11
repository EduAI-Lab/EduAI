import { useCallback } from "react";
import { useLoaderData, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AiModelsAdminView } from "~/components/admin/ai-models-admin-view";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { useAiModels } from "~/hooks/api/use-ai-models";
import { useAiProviders } from "~/hooks/api/use-ai-providers";
import { auth } from "~/lib/auth/server";

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
  const {
    providers,
    isLoading: providersLoading,
    error: providersError,
    refresh: refreshProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleProviderActive,
  } = useAiProviders();
  const {
    models,
    isLoading: modelsLoading,
    error: modelsError,
    createModel,
    updateModel,
    deleteModel,
    toggleModelActive,
  } = useAiModels();

  const isLoading = providersLoading || modelsLoading;
  const error = providersError ?? modelsError;

  const handleCreateModel = useCallback(
    async (data: Record<string, unknown>) => {
      await createModel(data);
      await refreshProviders();
    },
    [createModel, refreshProviders],
  );

  const handleUpdateModel = useCallback(
    async (id: string, data: Record<string, unknown>) => {
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
        <AiModelsAdminView
          providers={providers}
          models={models}
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
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
