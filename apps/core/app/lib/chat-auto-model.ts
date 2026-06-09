export const AUTO_MODEL_ID = "auto";

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
  name: "Auto",
  description: "Pick the best tier for this prompt (routing rules)",
  provider: "routing",
  supportsTools: true,
  supportsImages: true,
};

export function withAutoChatModel(
  models: ChatModelOption[],
  routerAutoEnabled: boolean,
): ChatModelOption[] {
  if (!routerAutoEnabled) return models;
  return [AUTO_CHAT_MODEL, ...models];
}

export function defaultChatModelId(
  models: ChatModelOption[],
  routerAutoEnabled: boolean,
): string {
  if (routerAutoEnabled) return AUTO_MODEL_ID;
  return models[0]?.id ?? "";
}
