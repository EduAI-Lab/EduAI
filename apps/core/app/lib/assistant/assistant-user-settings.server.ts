/**
 * @file What the in-panel settings pane reads and writes (#1823).
 *
 * Every option is built from the server on each read — never baked into the page
 * — because an administrator can enable a provider or re-curate models at any
 * moment, and a cached pane would offer choices the save then refuses. Saves
 * re-read and return freshly stored state rather than echoing the request.
 *
 * No payload here ever carries key material: only `hasOwnKey` and the masked tail.
 */
import { getAssistantSettings } from "~/lib/assistant/assistant-settings.server";
import { isSafeModelId } from "~/lib/assistant/assistant-settings";
import {
  chooseProviderAndModel,
  loadAssistantCatalogue,
  offeredModels,
  type CatalogueProvider,
} from "~/lib/assistant/provider-choice.server";
import {
  loadUserAiRows,
  maskKey,
  platformKeyFor,
  removeKey,
  saveAssistantPreference,
  setUserEnabledModels,
  type UserAiRow,
} from "~/lib/assistant/user-ai-keys.server";
import { PROVIDER_CONFIGS } from "~/lib/ai/provider-types";
import { USER_LISTABLE_PROVIDERS } from "~/lib/ai/list-provider-models.server";

export type AssistantProviderOption = {
  name: string;
  displayName: string;
  /** This provider needs a key at all (local inference does not). */
  requiresKey: boolean;
  hasOwnKey: boolean;
  /** Last 4 characters at most — the only sanctioned display of a key. */
  maskedKey: string | null;
  /** The deployment can pay for this provider without the user's key. */
  platformAvailable: boolean;
  /** The user can fetch this provider's live model list with their own key. */
  canFetchModels: boolean;
  adminModels: string[];
  /** The user's own curation: null = never curated, [] = curated nothing. */
  userModels: string[] | null;
  /** What the model dropdown may offer right now under the #1823 policy. */
  offeredModels: string[];
};

export type AssistantUserSettingsPayload = {
  providers: AssistantProviderOption[];
  /** The user's explicit choice, if any. */
  preferred: { provider: string; model: string | null } | null;
  /** What would actually answer the next question. Null → `no_key`. */
  effective: { provider: string; model: string; keySource: "SAVED" | "PLATFORM" | "PASTED" } | null;
};

function toOption(
  provider: CatalogueProvider,
  row: UserAiRow | undefined,
): AssistantProviderOption {
  return {
    name: provider.name,
    displayName: provider.displayName,
    requiresKey: PROVIDER_CONFIGS[provider.name].requiresApiKey,
    hasOwnKey: Boolean(row?.key),
    maskedKey: maskKey(row?.key ?? null),
    platformAvailable: platformKeyFor(provider.name) !== null,
    canFetchModels: USER_LISTABLE_PROVIDERS.includes(provider.name),
    adminModels: provider.models,
    userModels: row?.enabledModels ?? null,
    offeredModels: offeredModels(provider, row),
  };
}

export async function readAssistantUserSettings(
  userId: string,
): Promise<AssistantUserSettingsPayload> {
  const [catalogue, rows, settings] = await Promise.all([
    loadAssistantCatalogue(),
    loadUserAiRows(userId),
    getAssistantSettings(),
  ]);
  const rowFor = (name: string) => rows.find((row) => row.provider === name);
  const preferredRow = rows.find((row) => row.preferred);
  const effective = chooseProviderAndModel({
    catalogue,
    rows,
    defaultModel: settings.defaultModel,
  });
  return {
    providers: catalogue.map((provider) => toOption(provider, rowFor(provider.name))),
    preferred: preferredRow ? { provider: preferredRow.provider, model: preferredRow.model } : null,
    effective: effective
      ? { provider: effective.provider, model: effective.model, keySource: effective.key.tier }
      : null,
  };
}

export type SaveAssistantSettingsInput = {
  provider: string;
  model: string;
  apiKey?: string;
  removeKey?: boolean;
  enabledModels?: string[] | null;
};

export type SaveAssistantSettingsResult =
  | { ok: true; settings: AssistantUserSettingsPayload }
  | { ok: false; status: 422; error: string };

/**
 * Validate against the state the save WOULD produce, then write. A user may run a
 * model the admin catalogue allows, or one they curated themselves while holding
 * a key of their own for that provider — never a withheld model on the platform key.
 */
export async function saveAssistantUserSettings(
  userId: string,
  input: SaveAssistantSettingsInput,
): Promise<SaveAssistantSettingsResult> {
  const [catalogue, rows] = await Promise.all([loadAssistantCatalogue(), loadUserAiRows(userId)]);
  const provider = catalogue.find((entry) => entry.name === input.provider);
  if (!provider) return { ok: false, status: 422, error: "That provider isn't enabled." };
  if (!isSafeModelId(input.model))
    return { ok: false, status: 422, error: "That model id isn't valid." };
  if (input.enabledModels?.some((model) => !isSafeModelId(model))) {
    return { ok: false, status: 422, error: "One of the selected models isn't a valid id." };
  }

  const current = rows.find((row) => row.provider === provider.name);
  const newKey = input.apiKey?.trim() || null;
  const wouldHoldKey = newKey ? true : input.removeKey ? false : Boolean(current?.key);
  const wouldRow: UserAiRow = {
    id: current?.id ?? "pending",
    provider: provider.name,
    key: wouldHoldKey ? (newKey ?? current?.key ?? "pending") : null,
    model: input.model,
    preferred: true,
    enabledModels:
      input.enabledModels !== undefined ? input.enabledModels : (current?.enabledModels ?? null),
  };
  if (!offeredModels(provider, wouldRow).includes(input.model)) {
    return {
      ok: false,
      status: 422,
      error: wouldHoldKey
        ? "That model isn't available. Fetch your provider's models and enable it first."
        : "That model isn't in the administrator's catalogue. Save your own key for this provider to use other models.",
    };
  }

  await saveAssistantPreference(userId, {
    provider: provider.name,
    model: input.model,
    apiKey: newKey ?? undefined,
    removeKey: Boolean(input.removeKey) && !newKey,
  });
  if (input.enabledModels !== undefined) {
    await setUserEnabledModels(userId, provider.name, input.enabledModels);
  }
  return { ok: true, settings: await readAssistantUserSettings(userId) };
}

/** Remove the key for one provider, keeping the choice. */
export async function removeAssistantKey(userId: string, provider: string) {
  await removeKey(userId, provider);
  return readAssistantUserSettings(userId);
}
