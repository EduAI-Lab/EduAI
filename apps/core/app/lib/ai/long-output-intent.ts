const LONG_OUTPUT_PATTERNS = [
  /\bsummari[sz]e (?:this|the) (?:whole|entire) (?:chat|conversation)\b/i,
  /\brecap (?:this|the) (?:whole|entire) (?:chat|conversation)\b/i,
  /\b(?:full|complete) (?:chat|conversation) summary\b/i,
  /\bexplain everything (?:we|that we) covered\b/i,
  /\beverything we (?:covered|discussed|talked about)\b/i,
];

const CONTINUATION_PATTERNS = [
  /\bcontinue (?:the )?previous response\b/i,
  /\bcontinue from where (?:you|it) stopped\b/i,
];

export function isLongOutputIntent(prompt: string): boolean {
  const normalizedPrompt = prompt.trim();

  if (!normalizedPrompt) {
    return false;
  }

  return (
    LONG_OUTPUT_PATTERNS.some((pattern) =>
      pattern.test(normalizedPrompt),
    ) ||
    CONTINUATION_PATTERNS.some((pattern) =>
      pattern.test(normalizedPrompt),
    )
  );
}