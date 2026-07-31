export const ROUTING_MODEL_SETTING_DEFINITIONS = {
  autoLlmEnabled: {
    id: "auto-llm",
    name: "Auto",
    default: true,
    description:
      "Uses a lightweight LLM classifier to choose the smallest active routing-tier model that can answer each prompt.",
  },
  autoRulesEnabled: {
    id: "auto",
    name: "Auto (rules)",
    default: false,
    description:
      "Uses fixed prompt, image, tool, and course-context rules to choose among active routing-tier models.",
  },
} as const;

export type RoutingModelSettingKey =
  keyof typeof ROUTING_MODEL_SETTING_DEFINITIONS;

export type RoutingModelSettings = Record<RoutingModelSettingKey, boolean>;

export function isRoutingModelSettingKey(
  value: string,
): value is RoutingModelSettingKey {
  return value in ROUTING_MODEL_SETTING_DEFINITIONS;
}

export function defaultRoutingModelSettings(): RoutingModelSettings {
  return {
    autoLlmEnabled: ROUTING_MODEL_SETTING_DEFINITIONS.autoLlmEnabled.default,
    autoRulesEnabled:
      ROUTING_MODEL_SETTING_DEFINITIONS.autoRulesEnabled.default,
  };
}

export function routingModelSettingDefinitions() {
  return Object.entries(ROUTING_MODEL_SETTING_DEFINITIONS).map(
    ([key, definition]) => ({
      key: key as RoutingModelSettingKey,
      ...definition,
    }),
  );
}
