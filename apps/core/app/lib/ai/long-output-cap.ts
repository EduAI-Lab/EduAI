import { isLongOutputIntent } from "./long-output-intent";

export { isLongOutputIntent };

const DEFAULT_LONG_OUTPUT_MAX_TOKENS = 1200;
const DEFAULT_ADHD_LONG_OUTPUT_MAX_TOKENS = 600;

function resolvePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function resolveLongOutputMaxTokens(
  adhdAssist: boolean,
): number {
  if (adhdAssist) {
    return resolvePositiveInteger(
      process.env.CHAT_LONG_OUTPUT_ADHD_MAX_TOKENS,
      DEFAULT_ADHD_LONG_OUTPUT_MAX_TOKENS,
    );
  }

  return resolvePositiveInteger(
    process.env.CHAT_LONG_OUTPUT_MAX_TOKENS,
    DEFAULT_LONG_OUTPUT_MAX_TOKENS,
  );
}

export function capTokensForLongOutputIntent({
  prompt,
  currentMaxTokens,
  adhdAssist,
}: {
  prompt: string;
  currentMaxTokens: number;
  adhdAssist: boolean;
}): {
  maxTokens: number;
  isLongOutputIntent: boolean;
} {
  const longOutputIntent = isLongOutputIntent(prompt);

  if (!longOutputIntent) {
    return {
      maxTokens: currentMaxTokens,
      isLongOutputIntent: false,
    };
  }

  const uxCap = resolveLongOutputMaxTokens(adhdAssist);

  return {
    maxTokens: Math.min(currentMaxTokens, uxCap),
    isLongOutputIntent: true,
  };
}