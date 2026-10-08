/**
 * @file Admin settings for the site-wide help assistant (#1817) — pure data, no
 * server deps, so the admin cards and the server reader share one definition.
 *
 * The persona name lives here too, in exactly one constant: "Penny" is a product
 * decision that can change again, so it appears in user-facing copy only and
 * never in routes, modules or setting keys.
 */

/** The assistant's user-facing name. Copy reads this; nothing else should. */
export const ASSISTANT_DISPLAY_NAME = "Penny";

/** `SystemConfig.key` prefix for every assistant setting. */
export const ASSISTANT_SETTING_PREFIX = "assistant.";

export const ASSISTANT_MAX_DOCS_MIN = 1;
export const ASSISTANT_MAX_DOCS_MAX = 5;
export const ASSISTANT_MAX_DOCS_DEFAULT = 3;

/**
 * Model ids are interpolated into provider URL paths, so a stored model id has to
 * pass the same conservative character allowlist everywhere it is accepted — on
 * the admin save and again at use time.
 */
export const SAFE_MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@+-]{1,128}$/;

export function isSafeModelId(value: string): boolean {
  return SAFE_MODEL_ID_PATTERN.test(value) && !value.includes("..");
}

export type AssistantSettings = {
  /** The docs/how-to half. Off by default: it spends the platform key. */
  enableHelpAssistant: boolean;
  /** Students may ask about the course material they are viewing. Staff bypass it. */
  enableStudentMaterialQuestions: boolean;
  /** Documentation pages one answer may draw on, clamped to 1..5. */
  maxDocs: number;
  /** `provider:model` for follow-up query rewriting; empty reuses the answer model. */
  routerModel: string;
  /** `provider:model` the assistant falls back to before trying the catalogue in order. */
  defaultModel: string;
};

export type AssistantSettingKey = keyof AssistantSettings;

/** The stored key for each setting. Names match the spec so they read the same in SQL. */
export const ASSISTANT_SETTING_STORAGE_KEYS = {
  enableHelpAssistant: "assistant.enable_help_assistant",
  enableStudentMaterialQuestions: "assistant.enable_student_material_questions",
  maxDocs: "assistant.ai_assistant_max_docs",
  routerModel: "assistant.ai_assistant_router_model",
  defaultModel: "assistant.ai_assistant_default_model",
} as const satisfies Record<AssistantSettingKey, string>;

export const ASSISTANT_SETTING_DEFINITIONS = {
  enableHelpAssistant: {
    label: `Enable ${ASSISTANT_DISPLAY_NAME}, the help assistant`,
    description:
      "Answer platform how-to questions from the role-scoped user guide, on every signed-in page. Each question is a billed model call when the asker has no key of their own.",
  },
  enableStudentMaterialQuestions: {
    label: "Students can ask about course material",
    description:
      "Let students ask the assistant about the course or material they are viewing. Instructors and administrators keep this for their own courses even when it is off.",
  },
  maxDocs: {
    label: "Documentation pages per answer",
    description: "How many user-guide pages one answer may draw on (1–5).",
  },
  routerModel: {
    label: "Follow-up rewriting model",
    description:
      "Optional cheaper model (provider:model) used to turn a follow-up into a standalone search. Used only when it belongs to the provider answering the question; blank reuses the answer model.",
  },
  defaultModel: {
    label: "Default answer model",
    description:
      "The provider:model the assistant uses when a user has not chosen one and holds no key of their own. Blank uses the first usable model in the catalogue.",
  },
} satisfies Record<AssistantSettingKey, { label: string; description: string }>;

export function defaultAssistantSettings(): AssistantSettings {
  return {
    enableHelpAssistant: false,
    enableStudentMaterialQuestions: true,
    maxDocs: ASSISTANT_MAX_DOCS_DEFAULT,
    routerModel: "",
    defaultModel: "",
  };
}

export function clampMaxDocs(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return ASSISTANT_MAX_DOCS_DEFAULT;
  return Math.min(ASSISTANT_MAX_DOCS_MAX, Math.max(ASSISTANT_MAX_DOCS_MIN, Math.floor(parsed)));
}

/** A stored model id, or "" when blank or unsafe — an unsafe value is never used. */
export function normalizeModelSetting(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed && isSafeModelId(trimmed) ? trimmed : "";
}

/** Stored text → typed settings. Anything unreadable keeps its default. */
export function parseAssistantSettings(rows: Map<string, string>): AssistantSettings {
  const settings = defaultAssistantSettings();
  const read = (key: AssistantSettingKey) => rows.get(ASSISTANT_SETTING_STORAGE_KEYS[key]);

  const help = read("enableHelpAssistant");
  if (help !== undefined) settings.enableHelpAssistant = help === "true";
  const material = read("enableStudentMaterialQuestions");
  if (material !== undefined) settings.enableStudentMaterialQuestions = material === "true";
  const maxDocs = read("maxDocs");
  if (maxDocs !== undefined && maxDocs.trim() !== "") settings.maxDocs = clampMaxDocs(maxDocs);
  settings.routerModel = normalizeModelSetting(read("routerModel"));
  settings.defaultModel = normalizeModelSetting(read("defaultModel"));
  return settings;
}
