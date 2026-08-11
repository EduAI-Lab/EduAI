/**
 * Shared production gate: should an approved QM variant be pushed to Core?
 * Used by `routes/variants.js` (state-based push after approve) and the
 * cross-ext-push PICT adapter so the adapter cannot drift from the route.
 *
 * Push when the variant is approved (`isDraft === false`) and not yet linked.
 */
export function shouldPushApprovedVariantToCore(variant) {
  return variant?.isDraft === false && !variant?.coreQuestionId;
}
