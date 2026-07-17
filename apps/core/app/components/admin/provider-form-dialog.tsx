/**
 * Core thin wrapper — re-exports the shared ProviderFormDialog from @eduai/ui.
 *
 * The local AIProvider alias includes the `models` field used by
 * ai-models-admin-view; we keep it here so the view's types still compile.
 * The form dialog only needs the base AIProviderRecord fields.
 */
import {
  ProviderFormDialog as SharedProviderFormDialog,
  type AIProviderRecord,
  type ProviderFormDialogProps as SharedProviderFormDialogProps,
  type ProviderFormData,
} from "@eduai/ui";
import type { AIModel } from "~/types/ai";

// Extended type used by the Core admin view (includes models list).
type AIProvider = AIProviderRecord & {
  models?: AIModel[];
  _count?: {
    models: number;
  };
};

export interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: AIProvider | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSubmit: (data: any) => void;
}

export { type ProviderFormData };

export function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
  onSubmit,
}: ProviderFormDialogProps) {
  // Strip extended fields before passing to shared component
  const baseProvider: AIProviderRecord | null | undefined = provider
    ? {
        id: provider.id,
        name: provider.name,
        displayName: provider.displayName,
        description: provider.description,
        requiresApiKey: provider.requiresApiKey,
        defaultBaseUrl: provider.defaultBaseUrl,
        envVarName: provider.envVarName,
        isActive: provider.isActive,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      }
    : provider;

  return (
    <SharedProviderFormDialog
      open={open}
      onOpenChange={onOpenChange}
      provider={baseProvider}
      onSubmit={onSubmit as SharedProviderFormDialogProps["onSubmit"]}
    />
  );
}
