export const WEB_CHAT_TOOL_NAMES = ["webSearch", "fetchPage"] as const;

export type WebChatToolName = (typeof WEB_CHAT_TOOL_NAMES)[number];

export function isWebChatToolName(name: string): name is WebChatToolName {
  return (WEB_CHAT_TOOL_NAMES as readonly string[]).includes(name);
}

export const WEB_CHAT_TOOL_LABELS: Record<WebChatToolName, string> = {
  webSearch: "Searching the web…",
  fetchPage: "Reading web page…",
};

export function getChatToolDisplayName(
  toolName: string,
  webToolsEnabled: boolean,
): string | null {
  if (isWebChatToolName(toolName)) {
    if (!webToolsEnabled) return null;
    return WEB_CHAT_TOOL_LABELS[toolName];
  }

  if (toolName === "getInformation") {
    return "Searching course materials…";
  }

  return toolName;
}
