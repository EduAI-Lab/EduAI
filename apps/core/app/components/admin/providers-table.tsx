/**
 * Core thin wrapper — re-exports the shared ProvidersTable from @eduai/ui.
 *
 * The local AIProvider alias maps to the shared AIProviderRow shape so that
 * existing usages in Core (ai-models-admin-view, tests) compile unchanged.
 */
import {
  ProvidersTable as SharedProvidersTable,
  type AIProviderRow,
  type ProvidersTableProps as SharedProvidersTableProps,
} from "@eduai/ui";

// Keep the Core type name consistent with ~/types/ai usage throughout the app.
export type AIProvider = AIProviderRow;

export interface ProvidersTableProps {
  providers: AIProvider[];
  onEdit: (provider: AIProvider) => void;
  onDelete: (id: string) => void;
  onToggleActive: (provider: AIProvider) => void;
}

export function ProvidersTable(props: ProvidersTableProps) {
  return <SharedProvidersTable {...(props as SharedProvidersTableProps)} />;
}
