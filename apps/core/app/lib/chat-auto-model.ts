import type { RoutingModelSettings } from "~/lib/routing-model-settings";

export const AUTO_MODEL_ID = "auto";
export const AUTO_LLM_MODEL_ID = "auto-llm";

export type ChatModelOption = {
  id: string;
  name: string;
  description: string;
  provider: string;
  maxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
};

export const AUTO_CHAT_MODEL: ChatModelOption = {
  id: AUTO_MODEL_ID,
  name: "Auto (rules)",
  description: "Rule-based routing across active tiered models",
  provider: "routing",
  supportsTools: true,
  supportsImages: true,
};

export const AUTO_LLM_CHAT_MODEL: ChatModelOption = {
  id: AUTO_LLM_MODEL_ID,
  name: "Auto",
  description: "LLM-classified routing across active tiered models",
  provider: "routing",
  supportsTools: true,
  supportsImages: true,
};

export const ROUTING_CHAT_MODELS: ChatModelOption[] = [
  AUTO_LLM_CHAT_MODEL,
  AUTO_CHAT_MODEL,
];

export function isAutoRoutingModelId(modelId: string): boolean {
  return modelId === AUTO_MODEL_ID || modelId === AUTO_LLM_MODEL_ID;
}

export function withAutoChatModel(
  models: ChatModelOption[],
  settings: RoutingModelSettings,
): ChatModelOption[] {
  const routingModels = [
    ...(settings.autoLlmEnabled ? [AUTO_LLM_CHAT_MODEL] : []),
    ...(settings.autoRulesEnabled ? [AUTO_CHAT_MODEL] : []),
  ];
  return [...routingModels, ...models];
}

export function defaultChatModelId(
  models: ChatModelOption[],
  routerAutoEnabled: boolean,
): string {
  if (routerAutoEnabled) {
    if (models.some((model) => model.id === AUTO_LLM_MODEL_ID)) {
      return AUTO_LLM_MODEL_ID;
    }
    if (models.some((model) => model.id === AUTO_MODEL_ID)) {
      return AUTO_MODEL_ID;
    }
  }
  return models[0]?.id ?? "";
}

/** Human-readable model name for a registry id (`provider:modelId`). */
export function displayNameForRegistryId(
  registryId: string,
  models: ChatModelOption[],
): string {
  return models.find((m) => m.id === registryId)?.name ?? registryId;
}
