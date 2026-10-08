/**
 * @file Which provider, key and model answer one assistant question (#1818 §6).
 *
 * The user's own configuration first, the administrator's as fallback. The
 * choice itself ({@link chooseProviderAndModel}) is pure over a loaded catalogue
 * and the user's rows, so every step is unit-testable without a database.
 */
import prisma from "~/lib/prisma.server";
import {
  PROVIDER_CONFIGS,
  parseModelIdentifier,
  type SupportedProvider,
} from "~/lib/ai/provider-types";
import {
  loadUserAiRows,
  resolveProviderKey,
  type ResolvedProviderKey,
  type UserAiRow,
} from "~/lib/assistant/user-ai-keys.server";

/** One enabled provider and the chat models the administrator's catalogue allows on it. */
export type CatalogueProvider = {
  name: SupportedProvider;
  displayName: string;
  /** Admin-curated active CHAT model ids, in catalogue order. May be empty. */
  models: string[];
};

function isAssistantProvider(name: string): name is SupportedProvider {
  // Bedrock is overflow-only and never user-selectable anywhere in Core.
  return name !== "bedrock" && Object.prototype.hasOwnProperty.call(PROVIDER_CONFIGS, name);
}

/**
 * Every active provider the assistant may use, in catalogue order (provider
 * name, then model id — the same order `GET /api/models` serves).
 */
export async function loadAssistantCatalogue(): Promise<CatalogueProvider[]> {
  const providers = await prisma.aIProvider.findMany({
    where: { isActive: true },
    select: {
      name: true,
      displayName: true,
      models: {
        where: { isActive: true, type: "CHAT" },
        select: { modelId: true },
        orderBy: { modelId: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return providers.flatMap((provider) => {
    const name = provider.name;
    if (!isAssistantProvider(name)) return [];
    return [
      { name, displayName: provider.displayName, models: provider.models.map((m) => m.modelId) },
    ];
  });
}

/** True when at least one provider has a model the administrator allows. */
export function catalogueHasEnabledProvider(catalogue: CatalogueProvider[]): boolean {
  return catalogue.some((provider) => provider.models.length > 0);
}

/**
 * The models this user may run on this provider: the admin catalogue, plus the
 * models they curated themselves — but only while they hold a key of their own
 * for it (#1823). Admin curation bounds what the PLATFORM key may be spent on; a
 * user with no key is spending exactly that wallet, so their own ticks do not
 * widen it.
 */
export function offeredModels(provider: CatalogueProvider, row: UserAiRow | undefined): string[] {
  const own = row?.key && row.enabledModels ? row.enabledModels : [];
  return [...new Set([...provider.models, ...own])];
}

/** `wanted` when still offered, else the provider's first offered model, else null. */
function pickModel(
  provider: CatalogueProvider,
  row: UserAiRow | undefined,
  wanted: string | null | undefined,
): string | null {
  const offered = offeredModels(provider, row);
  if (wanted && offered.includes(wanted)) return wanted;
  return offered[0] ?? null;
}

export type ProviderChoiceStep =
  | "explicit_preference"
  | "own_key"
  | "admin_default"
  | "first_usable";

export type ProviderChoice = {
  provider: SupportedProvider;
  model: string;
  key: ResolvedProviderKey;
  step: ProviderChoiceStep;
};

/**
 * The five steps, in order:
 * 1. the user's explicit preferred row, if its provider is still enabled and a key
 *    resolves (theirs or the platform's); a stored model the provider no longer
 *    offers falls back to its first offered model;
 * 2. the first enabled provider the user saved a key of their own for;
 * 3. the admin default provider, if enabled and a key resolves for this user;
 * 4. the first enabled provider where both a key and a model resolve;
 * 5. null — the caller reports `no_key`.
 */
export function chooseProviderAndModel(input: {
  catalogue: CatalogueProvider[];
  rows: UserAiRow[];
  defaultModel: string;
}): ProviderChoice | null {
  const { catalogue, rows } = input;
  const rowFor = (name: string) => rows.find((row) => row.provider === name);
  const providerFor = (name: string) => catalogue.find((provider) => provider.name === name);
  const keyFor = (provider: CatalogueProvider) =>
    resolveProviderKey({ provider: provider.name, saved: rowFor(provider.name)?.key ?? null });

  const attempt = (
    provider: CatalogueProvider | undefined,
    wanted: string | null | undefined,
    step: ProviderChoiceStep,
  ): ProviderChoice | null => {
    if (!provider) return null;
    const key = keyFor(provider);
    if (!key) return null;
    const model = pickModel(provider, rowFor(provider.name), wanted);
    if (!model) return null;
    return { provider: provider.name, model, key, step };
  };

  // 1. Explicit preference. A key-less row ("run X on the admin's key") wins here
  //    and falls through to the platform tier inside keyFor.
  const preferred = rows.find((row) => row.preferred);
  if (preferred) {
    const choice = attempt(providerFor(preferred.provider), preferred.model, "explicit_preference");
    if (choice) return choice;
  }

  // 2. A key the user bothered to save must not sit unused while the platform pays.
  //    Only rows that really hold a decryptable key count.
  for (const provider of catalogue) {
    const row = rowFor(provider.name);
    if (!row?.key) continue;
    const choice = attempt(provider, row.model, "own_key");
    if (choice) return choice;
  }

  // 3. The admin default. A default model that is not offered by its own provider
  //    is replaced by that provider's first model.
  const parsedDefault = input.defaultModel ? parseModelIdentifier(input.defaultModel) : null;
  if (parsedDefault) {
    const choice = attempt(
      providerFor(parsedDefault.providerId),
      parsedDefault.modelId,
      "admin_default",
    );
    if (choice) return choice;
  }

  // 4. First usable, in catalogue order.
  for (const provider of catalogue) {
    const choice = attempt(provider, null, "first_usable");
    if (choice) return choice;
  }

  return null;
}

/**
 * The model for follow-up query rewriting. The admin's router model is used only
 * when it names one of the CHOSEN provider's own offered models — validated here,
 * at use time, because the catalogue can change after it was saved. Otherwise the
 * answer model does the job.
 */
export function resolveRouterModel(input: {
  choice: ProviderChoice;
  catalogue: CatalogueProvider[];
  rows: UserAiRow[];
  routerModel: string;
}): string {
  const parsed = input.routerModel ? parseModelIdentifier(input.routerModel) : null;
  if (!parsed || parsed.providerId !== input.choice.provider) return input.choice.model;
  const provider = input.catalogue.find((entry) => entry.name === parsed.providerId);
  if (!provider) return input.choice.model;
  const row = input.rows.find((entry) => entry.provider === provider.name);
  return offeredModels(provider, row).includes(parsed.modelId)
    ? parsed.modelId
    : input.choice.model;
}

/** Load everything the choice needs and make it. */
export async function resolveAssistantProvider(userId: string, defaultModel: string) {
  const [catalogue, rows] = await Promise.all([loadAssistantCatalogue(), loadUserAiRows(userId)]);
  return { catalogue, rows, choice: chooseProviderAndModel({ catalogue, rows, defaultModel }) };
}
