/**
 * Campus-model size ranking for QM pickers/probes.
 *
 * Moved to @eduai/types so the QM frontend can use it without depending on
 * question-maker-backend/src internals (see PR #1296 review). This module
 * just re-exports the shared implementation for existing backend callers.
 */
export { MODEL_SIZE_RANK_PATTERNS, modelSizeRankFromText } from '@eduai/types';
