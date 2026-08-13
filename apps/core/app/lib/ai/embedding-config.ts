/** Shared 1024-dim embedding options for per-course settings (LOCAL-EMBEDDINGS). */

export type EmbeddingProviderSetting = "local" | "ollama" | "cloud";

export type CourseEmbeddingFields = {
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddedWithProvider: string | null;
  embeddedWithModel: string | null;
  lastEmbeddedAt: Date | null;
};

export type EffectiveEmbeddingSettings = {
  provider: EmbeddingProviderSetting;
  model: string;
  wantsLocal: boolean;
  source: { provider: "course" | "env"; model: "course" | "env" };
};

export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "mxbai-embed-large";
export const DEFAULT_OPENROUTER_OPENAI_MODEL = "openai/text-embedding-3-small";
export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

export const ALLOWED_LOCAL_EMBEDDING_MODELS = [
  { id: DEFAULT_OLLAMA_EMBEDDING_MODEL, label: "mxbai-embed-large (Ollama)" },
] as const;

export const ALLOWED_CLOUD_EMBEDDING_MODELS = [
  {
    id: DEFAULT_OPENROUTER_OPENAI_MODEL,
    label: "text-embedding-3-small via OpenRouter",
  },
  {
    id: DEFAULT_OPENAI_EMBEDDING_MODEL,
    label: "text-embedding-3-small (OpenAI direct)",
  },
] as const;

const LOCAL_PROVIDER_ALIASES = new Set(["local", "ollama"]);

export function normalizeEmbeddingProvider(
  value: string | null | undefined,
): EmbeddingProviderSetting | null {
  if (value == null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (LOCAL_PROVIDER_ALIASES.has(normalized)) return "local";
  if (normalized === "cloud") return "cloud";
  return null;
}

export function resolveEnvEmbeddingProvider(): EmbeddingProviderSetting {
  const env = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (env === "local" || env === "ollama") return "local";
  return "cloud";
}

export function resolveEnvEmbeddingModel(provider: EmbeddingProviderSetting): string {
  if (provider === "local") {
    return (
      process.env.VLLM_EMBEDDING_MODEL?.trim() ||
      process.env.OLLAMA_EMBEDDING_MODEL?.trim() ||
      DEFAULT_OLLAMA_EMBEDDING_MODEL
    );
  }
  return (
    process.env.OPENROUTER_EMBEDDING_MODEL?.trim() ||
    DEFAULT_OPENROUTER_OPENAI_MODEL
  );
}

export function resolveEffectiveEmbeddingSettings(
  course: CourseEmbeddingFields | null | undefined,
): EffectiveEmbeddingSettings {
  const courseProvider = normalizeEmbeddingProvider(course?.embeddingProvider);
  const envProvider = resolveEnvEmbeddingProvider();
  const provider = courseProvider ?? envProvider;

  const envModel = resolveEnvEmbeddingModel(provider);
  const courseModel = course?.embeddingModel?.trim() || null;
  const model = courseModel || envModel;

  return {
    provider,
    model,
    wantsLocal: provider === "local",
    source: {
      provider: courseProvider ? "course" : "env",
      model: courseModel ? "course" : "env",
    },
  };
}

export function isAllowedEmbeddingModel(
  provider: EmbeddingProviderSetting,
  model: string,
): boolean {
  const allowed =
    provider === "local"
      ? ALLOWED_LOCAL_EMBEDDING_MODELS
      : ALLOWED_CLOUD_EMBEDDING_MODELS;
  return allowed.some((entry) => entry.id === model);
}

export function isEmbeddingIndexStale(
  course: CourseEmbeddingFields,
  effective: EffectiveEmbeddingSettings,
): boolean {
  if (!course.embeddedWithModel && !course.embeddedWithProvider) {
    return false;
  }
  const indexedProvider =
    normalizeEmbeddingProvider(course.embeddedWithProvider) ?? course.embeddedWithProvider;
  return (
    indexedProvider !== effective.provider || course.embeddedWithModel !== effective.model
  );
}

export type EmbeddingSettingsUpdate = {
  embeddingProvider: string | null;
  embeddingModel: string | null;
};

export function parseEmbeddingSettingsUpdate(
  body: unknown,
): { ok: true; value: Partial<EmbeddingSettingsUpdate> } | { ok: false; error: string } {
  if (body == null || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;
  const hasProvider = "embeddingProvider" in record;
  const hasModel = "embeddingModel" in record;

  if (!hasProvider && !hasModel) {
    return { ok: false, error: "Provide embeddingProvider and/or embeddingModel" };
  }

  const value: Partial<EmbeddingSettingsUpdate> = {};

  if (hasProvider) {
    const raw = record.embeddingProvider;
    if (raw === null || raw === "") {
      value.embeddingProvider = null;
    } else if (typeof raw === "string") {
      if (normalizeEmbeddingProvider(raw) == null) {
        return {
          ok: false,
          error: "embeddingProvider must be local, ollama, cloud, or null",
        };
      }
      value.embeddingProvider =
        raw.trim().toLowerCase() === "ollama" ? "local" : raw.trim().toLowerCase();
    } else {
      return { ok: false, error: "embeddingProvider must be a string or null" };
    }
  }

  if (hasModel) {
    const raw = record.embeddingModel;
    if (raw === null || raw === "") {
      value.embeddingModel = null;
    } else if (typeof raw === "string") {
      value.embeddingModel = raw.trim();
    } else {
      return { ok: false, error: "embeddingModel must be a string or null" };
    }
  }

  return { ok: true, value };
}

export function validateEmbeddingSettingsUpdate(
  current: CourseEmbeddingFields,
  update: Partial<EmbeddingSettingsUpdate>,
): { ok: true; value: EmbeddingSettingsUpdate } | { ok: false; error: string } {
  const nextProvider =
    update.embeddingProvider !== undefined
      ? update.embeddingProvider
      : current.embeddingProvider;
  const nextModel =
    update.embeddingModel !== undefined ? update.embeddingModel : current.embeddingModel;

  const effective = resolveEffectiveEmbeddingSettings({
    ...current,
    embeddingProvider: nextProvider,
    embeddingModel: nextModel,
  });

  if (nextModel && !isAllowedEmbeddingModel(effective.provider, nextModel)) {
    return {
      ok: false,
      error: `Model "${nextModel}" is not allowed for provider "${effective.provider}"`,
    };
  }

  return {
    ok: true,
    value: {
      embeddingProvider: nextProvider,
      embeddingModel: nextModel,
    },
  };
}
