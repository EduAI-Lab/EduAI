/**
 * Shared parsing / SQL helpers for GET /api/questions list filters (#1040 review).
 * Variant-scoped predicates use EXISTS so we can keep `separate: true` on the
 * variants include (limit/offset stay on question_metadata rows).
 */
import { Op } from 'sequelize';
import { sequelize } from '../config/database.js';
import { escapeLikeLiteral } from './listPagination.js';

const ALLOWED_TYPES = new Set(['MCQ', 'SA', 'LA']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const ALLOWED_REASONING = new Set(['factual', 'analytical', 'application']);
const ALLOWED_SORT = new Set(['newest', 'oldest', 'type', 'difficulty']);

/** Split comma-separated or repeated query values into a unique string list. */
export function parseCsvParam(value) {
  if (value == null || value === '') return [];
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(parts.map((p) => String(p).trim()).filter(Boolean))];
}

/**
 * Normalize list filter/sort query fields from Express `req.query` (or options).
 */
export function parseQuestionListFilters(query = {}) {
  const types = parseCsvParam(query.types ?? query.type).filter((t) =>
    ALLOWED_TYPES.has(t),
  );
  const difficulties = parseCsvParam(
    query.difficulties ?? query.difficulty,
  ).filter((d) => ALLOWED_DIFFICULTIES.has(d));
  const reasoningLevels = parseCsvParam(
    query.reasoningLevels ?? query.reasoningLevel,
  ).filter((r) => ALLOWED_REASONING.has(r));

  const aiRaw = String(query.aiGenerated ?? 'all').trim().toLowerCase();
  const aiGenerated =
    aiRaw === 'ai' || aiRaw === 'not-ai' || aiRaw === 'all' ? aiRaw : 'all';

  const draftRaw = String(query.draftStatus ?? 'all').trim().toLowerCase();
  const draftStatus =
    draftRaw === 'draft' || draftRaw === 'reviewed' || draftRaw === 'all'
      ? draftRaw
      : 'all';

  const sortRaw = String(query.sortBy ?? 'newest').trim().toLowerCase();
  const sortBy = ALLOWED_SORT.has(sortRaw) ? sortRaw : 'newest';

  const search =
    query.search != null && String(query.search).trim()
      ? String(query.search).trim()
      : null;

  return {
    search,
    types,
    difficulties,
    reasoningLevels,
    aiGenerated,
    draftStatus,
    sortBy,
  };
}

/**
 * EXISTS (SELECT 1 FROM variants …) correlated to the outer Question_Metadata row.
 * `fragment` is AND-ed inside the subquery (caller must escape values).
 */
export function variantExistsLiteral(fragment) {
  return sequelize.literal(
    `EXISTS (SELECT 1 FROM variants AS _v WHERE _v.question_metadata_id = "Question_Metadata"."id" AND (${fragment}))`,
  );
}

/**
 * Build Sequelize `where` + `order` for getQuestionsByUser from parsed filters.
 */
export function buildQuestionListQuery(filters = {}) {
  const {
    search = null,
    types = [],
    difficulties = [],
    reasoningLevels = [],
    aiGenerated = 'all',
    draftStatus = 'all',
    sortBy = 'newest',
  } = filters;

  const and = [];

  if (types.length > 0) {
    and.push({ type: { [Op.in]: types } });
  }

  if (search) {
    const needle = escapeLikeLiteral(search);
    if (needle) {
      const pattern = `%${needle}%`;
      and.push({
        [Op.or]: [
          { description: { [Op.iLike]: pattern } },
          variantExistsLiteral(
            `_v.question_text ILIKE ${sequelize.escape(pattern)}`,
          ),
        ],
      });
    }
  }

  const variantPreds = [];
  if (difficulties.length > 0) {
    const list = difficulties.map((d) => sequelize.escape(d)).join(', ');
    variantPreds.push(`_v.difficulty IN (${list})`);
  }
  if (reasoningLevels.length > 0) {
    const list = reasoningLevels.map((r) => sequelize.escape(r)).join(', ');
    variantPreds.push(`_v.reasoning_level IN (${list})`);
  }
  if (aiGenerated === 'ai') {
    variantPreds.push('_v.is_ai_generated = TRUE');
  } else if (aiGenerated === 'not-ai') {
    variantPreds.push('_v.is_ai_generated = FALSE');
  }
  if (draftStatus === 'draft') {
    variantPreds.push('_v.is_draft = TRUE');
  } else if (draftStatus === 'reviewed') {
    variantPreds.push('_v.is_draft = FALSE');
  }

  if (variantPreds.length > 0) {
    and.push(variantExistsLiteral(variantPreds.join(' AND ')));
  }

  let order;
  switch (sortBy) {
    case 'oldest':
      order = [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ];
      break;
    case 'type':
      order = [
        ['type', 'ASC'],
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ];
      break;
    case 'difficulty':
      // Representative variant difficulty (MIN rank), then newest.
      order = [
        [
          sequelize.literal(`(
            SELECT CASE MIN(_v.difficulty)
              WHEN 'easy' THEN 0
              WHEN 'medium' THEN 1
              WHEN 'hard' THEN 2
              ELSE 1
            END
            FROM variants AS _v
            WHERE _v.question_metadata_id = "Question_Metadata"."id"
          )`),
          'ASC',
        ],
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ];
      break;
    case 'newest':
    default:
      order = [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ];
      break;
  }

  const where = and.length > 0 ? { [Op.and]: and } : {};
  return { where, order };
}
