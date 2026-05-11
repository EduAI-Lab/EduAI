/**
 * Scores how well a bank question matches a baseline slot (higher = better).
 * Pure helper used by assessment variant assembly (metadata similarity mode).
 */
export function scoreMetadataMatch(slotMeta, slotVariant, bankMeta, bankVariant) {
  let s = 0;
  if (slotMeta?.primaryTopicId != null && bankMeta?.primaryTopicId === slotMeta.primaryTopicId) s += 100;
  if (slotMeta?.type && bankMeta?.type === slotMeta.type) s += 50;
  if (slotVariant?.difficulty && bankVariant?.difficulty === slotVariant.difficulty) s += 25;
  if (slotVariant?.reasoningLevel && bankVariant?.reasoningLevel === slotVariant.reasoningLevel) s += 10;
  return s;
}
