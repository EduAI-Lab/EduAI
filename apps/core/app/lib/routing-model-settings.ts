export const ROUTING_MODEL_SETTING_DEFINITIONS = {
  autoLlmEnabled: {
    id: "auto-llm",
    name: "Auto",
    default: true,
    description:
      "Uses a lightweight classifier to choose between the configured Small and Large model groups for each prompt.",
  },
  autoRulesEnabled: {
    id: "auto",
    name: "Auto (rules)",
    default: false,
    description:
      "Uses fixed prompt, image, tool, and course-context rules to choose between the configured Small and Large model groups.",
  },
} as const;

export type RoutingModelSettingKey = keyof typeof ROUTING_MODEL_SETTING_DEFINITIONS;

/**
 * Every routing toggle and whether it is on. Spelled as a mapped type over the
 * known keys rather than an open dictionary: there are exactly these settings,
 * and a caller may read any of them without checking it exists.
 */
export type RoutingModelSettings = { [K in RoutingModelSettingKey]: boolean };

export function isRoutingModelSettingKey(value: string): value is RoutingModelSettingKey {
  return value in ROUTING_MODEL_SETTING_DEFINITIONS;
}

export function defaultRoutingModelSettings(): RoutingModelSettings {
  return {
    autoLlmEnabled: ROUTING_MODEL_SETTING_DEFINITIONS.autoLlmEnabled.default,
    autoRulesEnabled: ROUTING_MODEL_SETTING_DEFINITIONS.autoRulesEnabled.default,
  };
}

export function routingModelSettingDefinitions() {
  return Object.entries(ROUTING_MODEL_SETTING_DEFINITIONS).map(([key, definition]) => ({
    key: key as RoutingModelSettingKey,
    ...definition,
  }));
}
