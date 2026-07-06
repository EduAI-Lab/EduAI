import type { RouterMode } from "~/lib/ai/routing/router";

type GenericMessage = Record<string, unknown>;

export function resolveAutoRouting(model: string | undefined): {
  routeWithAuto: boolean;
  modeOverride?: RouterMode;
  requestedAuto: string | null;
} {
  if (model === undefined || model === "auto") {
    return { routeWithAuto: true, requestedAuto: model ?? "auto" };
  }
  if (model === "auto-llm") {
    return {
      routeWithAuto: true,
      modeOverride: "llm",
      requestedAuto: "auto-llm",
    };
  }
  if (model === "auto-hybrid") {
    return {
      routeWithAuto: true,
      modeOverride: "hybrid",
      requestedAuto: "auto-hybrid",
    };
  }
  return { routeWithAuto: false, requestedAuto: null };
}

export function userMessageHasImages(message?: GenericMessage): boolean {
  const content = message?.content;
  if (!content) {
    return false;
  }

  const partLooksLikeImage = (part: unknown): boolean => {
    if (!part || typeof part !== "object") {
      return false;
    }
    const p = part as Record<string, unknown>;
    const t = p.type;
    if (t === "image" || t === "image_url") {
      return true;
    }
    if (t === "file") {
      const mime = p.mimeType;
      return typeof mime === "string" && mime.startsWith("image/");
    }
    return false;
  };

  if (Array.isArray(content)) {
    return content.some(partLooksLikeImage);
  }
  return false;
}
