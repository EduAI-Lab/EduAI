/**
 * @file Per-user AI keys and model preference (#1818).
 *
 * One row per (user, provider) in `user_provider_settings`. The row carries an
 * encrypted key (nullable — a row may exist only to carry a model choice), the
 * model, a `preferred` flag and the user's own model curation.
 *
 * Two rules every caller relies on:
 *
 * 1. {@link plainKey} is the ONLY place a stored key is decrypted. It never
 *    throws: a blank or undecryptable value (e.g. after `ENCRYPTION_KEY` was
 *    rotated) logs a warning naming only the row and reads as "no key saved", so
 *    one bad row cannot turn into a 500 on every request that user makes.
 *    "Does this user have a key?" must ask it, never row existence.
 * 2. Key resolution has one order — pasted → saved → platform → none — in
 *    {@link resolveProviderKey}. The help assistant never passes a pasted key.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { decrypt, encrypt } from "~/lib/canvas/encryption";
import prisma from "~/lib/prisma.server";
import { PROVIDER_CONFIGS, type SupportedProvider } from "~/lib/ai/provider-types";
import { fleetRoutingEnabled } from "~/lib/ai/routing/fleet/registry";
import { ASSISTANT_DISPLAY_NAME } from "~/lib/assistant/assistant-settings";

export type KeyTier = "PASTED" | "SAVED" | "PLATFORM";

export type ResolvedProviderKey = {
  tier: KeyTier;
  /** Undefined for a keyless platform provider (local vLLM / Ollama). */
  apiKey: string | undefined;
};

/** Masked display shows the last 4 characters only when the key is at least this long. */
export const MASK_MIN_LENGTH = 12;
const FULL_MASK = "••••••••";

const warnedRows = new Set<string>();

/**
 * Decrypt a stored key, or null. Never throws and never logs key material —
 * the warning names the row id only, and only once per row per process.
 */
export function plainKey(row: { id: string; apiKey: string | null }): string | null {
  const stored = row.apiKey?.trim();
  if (!stored) return null;
  try {
    const value = decrypt(stored).trim();
    return value || null;
  } catch {
    if (!warnedRows.has(row.id)) {
      warnedRows.add(row.id);
      console.warn(
        "[assistant/keys] stored provider key could not be decrypted; treating as unset",
        {
          rowId: row.id,
        },
      );
    }
    return null;
  }
}

/** Test seam: forget which rows have already logged. */
export function resetPlainKeyWarningsForTests(): void {
  warnedRows.clear();
}

/** The only sanctioned display of a key: last 4 chars when long enough, else fully masked. */
export function maskKey(plain: string | null): string | null {
  if (!plain) return null;
  if (plain.length < MASK_MIN_LENGTH) return FULL_MASK;
  return `${FULL_MASK}${plain.slice(-4)}`;
}

/**
 * The deployment's own credential for a provider, or null when it has none.
 * Local inference needs no key — availability is its configured endpoint.
 */
export function platformKeyFor(provider: SupportedProvider): ResolvedProviderKey | null {
  switch (provider) {
    case "vllm":
      return process.env.VLLM_BASE_URL?.trim() || fleetRoutingEnabled()
        ? { tier: "PLATFORM", apiKey: undefined }
        : null;
    case "ollama":
      return process.env.OLLAMA_BASE_URL?.trim() ? { tier: "PLATFORM", apiKey: undefined } : null;
    case "openai":
    case "google": {
      const envVar = PROVIDER_CONFIGS[provider].envVarName;
      const key = envVar ? process.env[envVar]?.trim() : undefined;
      return key ? { tier: "PLATFORM", apiKey: key } : null;
    }
    // OpenCode is account-scoped BYOK only; Bedrock is overflow-only.
    case "opencode":
    case "bedrock":
      return null;
  }
}

/**
 * The one resolution order every AI feature shares:
 * request-pasted key → the user's saved key → the platform key → none.
 * A blank pasted key counts as nothing pasted. The result remembers its tier so a
 * refusal can name the exact place to fix it.
 */
export function resolveProviderKey(input: {
  provider: SupportedProvider;
  pasted?: string | null;
  saved: string | null;
}): ResolvedProviderKey | null {
  const pasted = input.pasted?.trim();
  if (pasted) return { tier: "PASTED", apiKey: pasted };
  if (input.saved) return { tier: "SAVED", apiKey: input.saved };
  return platformKeyFor(input.provider);
}

/** Where a user goes to fix a key from this tier. */
export function describeKeyTier(tier: KeyTier): string {
  switch (tier) {
    case "PASTED":
      return "the API key sent with this request";
    case "SAVED":
      return `the API key saved in your ${ASSISTANT_DISPLAY_NAME} settings`;
    case "PLATFORM":
      return "the platform's key for this provider (ask an administrator)";
  }
}

/** One user row, decoded. `key` is the plaintext — server-only, never serialized. */
export type UserAiRow = {
  id: string;
  provider: string;
  key: string | null;
  model: string | null;
  preferred: boolean;
  enabledModels: string[] | null;
};

/** The stored curation column: a list of model ids, or null for "never curated". */
const storedModelCuration = z.array(z.string()).nullable().catch(null);

function decodeEnabledModels(value: Prisma.JsonValue | null): string[] | null {
  return storedModelCuration.parse(value);
}

export async function loadUserAiRows(userId: string): Promise<UserAiRow[]> {
  const rows = await prisma.userProviderSettings.findMany({
    where: { userId },
    select: {
      id: true,
      apiKey: true,
      model: true,
      preferred: true,
      enabledModels: true,
      createdAt: true,
      provider: { select: { name: true } },
    },
    // A violated "one preferred" invariant is tolerated by taking the first.
    orderBy: [{ preferred: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider.name,
    key: plainKey(row),
    model: row.model,
    preferred: row.preferred,
    enabledModels: decodeEnabledModels(row.enabledModels),
  }));
}

async function providerIdFor(
  tx: Prisma.TransactionClient,
  providerName: string,
): Promise<string | null> {
  const provider = await tx.aIProvider.findUnique({
    where: { name: providerName },
    select: { id: true },
  });
  return provider?.id ?? null;
}

/** True when nothing is left on a row, so deleting it loses nothing. */
function rowIsEmpty(row: {
  apiKey: string | null;
  baseUrl: string | null;
  isEnabled: boolean;
  model: string | null;
  preferred: boolean;
  enabledModels: Prisma.JsonValue | null;
}): boolean {
  return (
    !row.apiKey &&
    !row.baseUrl &&
    !row.isEnabled &&
    !row.model &&
    !row.preferred &&
    row.enabledModels === null
  );
}

export class UnknownProviderError extends Error {
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`);
    this.name = "UnknownProviderError";
  }
}

/**
 * The single writer for an assistant preference. Marks `provider` as the user's
 * one preferred row (clearing every other row's flag in the same transaction),
 * stores the model, and optionally stores or removes the key.
 */
export async function saveAssistantPreference(
  userId: string,
  input: { provider: string; model: string; apiKey?: string; removeKey?: boolean },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const providerId = await providerIdFor(tx, input.provider);
    if (!providerId) throw new UnknownProviderError(input.provider);

    await tx.userProviderSettings.updateMany({
      where: { userId, preferred: true, NOT: { providerId } },
      data: { preferred: false },
    });

    // A new key replaces the stored one, `removeKey` nulls it, and otherwise
    // `undefined` leaves the stored key untouched (Prisma skips undefined fields).
    const newKey = input.apiKey?.trim();
    const apiKey = newKey ? encrypt(newKey) : input.removeKey ? null : undefined;

    await tx.userProviderSettings.upsert({
      where: { userId_providerId: { userId, providerId } },
      create: {
        userId,
        providerId,
        model: input.model,
        preferred: true,
        apiKey: apiKey ?? null,
      },
      update: { model: input.model, preferred: true, apiKey },
    });
  });
}

/**
 * Back to the admin default. Keeps every key; drops only the choice. A row left
 * with nothing on it is deleted.
 */
export async function clearChoice(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.userProviderSettings.updateMany({
      where: { userId },
      data: { preferred: false, model: null },
    });
    const rows = await tx.userProviderSettings.findMany({
      where: { userId },
      select: {
        id: true,
        apiKey: true,
        baseUrl: true,
        isEnabled: true,
        model: true,
        preferred: true,
        enabledModels: true,
      },
    });
    const empty = rows.filter(rowIsEmpty).map((row) => row.id);
    if (empty.length > 0) {
      await tx.userProviderSettings.deleteMany({ where: { id: { in: empty } } });
    }
  });
}

/**
 * Delete the key for one provider. Keeps the provider/model choice: the key is
 * nulled when anything else remains on the row, the row deleted otherwise.
 */
export async function removeKey(userId: string, provider: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const providerId = await providerIdFor(tx, provider);
    if (!providerId) return;
    const row = await tx.userProviderSettings.findUnique({
      where: { userId_providerId: { userId, providerId } },
      select: {
        id: true,
        apiKey: true,
        baseUrl: true,
        isEnabled: true,
        model: true,
        preferred: true,
        enabledModels: true,
      },
    });
    if (!row) return;
    if (rowIsEmpty({ ...row, apiKey: null })) {
      await tx.userProviderSettings.delete({ where: { id: row.id } });
    } else {
      await tx.userProviderSettings.update({ where: { id: row.id }, data: { apiKey: null } });
    }
  });
}

/** Store (or, with `null`, forget) the user's own model curation for one provider. */
export async function setUserEnabledModels(
  userId: string,
  provider: string,
  models: string[] | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const providerId = await providerIdFor(tx, provider);
    if (!providerId) throw new UnknownProviderError(provider);
    const value = models === null ? null : [...new Set(models)];
    await tx.userProviderSettings.upsert({
      where: { userId_providerId: { userId, providerId } },
      create: { userId, providerId, enabledModels: value ?? Prisma.DbNull },
      update: { enabledModels: value ?? Prisma.DbNull },
    });
  });
}
