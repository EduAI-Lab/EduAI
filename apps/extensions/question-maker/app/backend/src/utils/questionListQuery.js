/**
 * Shared parsing / Prisma filter helpers for GET /api/questions list filters (#1040 review).
 * Variant-scoped predicates use relation filters so paging stays on question_metadata rows.
 */
import { escapeLikeLiteral } from './listPagination.js';

const ALLOWED_TYPES = new Set(['MCQ', 'SA', 'LA']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const ALLOWED_REASONING = new Set(['factual', 'analytical', 'application']);
// `difficulty` is intentionally omitted: Prisma cannot order question_metadata by a
// related variant's difficulty enum without a raw query, and falling back to
// newest would mislead library users who pick "By difficulty" (#1140 review).
const ALLOWED_SORT = new Set(['newest', 'oldest', 'type']);

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
 * Build Prisma `where` + `orderBy` for getQuestionsByUser from parsed filters.
 *
 * Prisma turns `contains` into ILIKE, so `%` / `_` / `\` in the search text must
 * be escaped via {@link escapeLikeLiteral} or they act as wildcards (#1140).
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
    and.push({ type: { in: types } });
  }

  if (search) {
    const escaped = escapeLikeLiteral(search);
    and.push({
      OR: [
        { description: { contains: escaped, mode: 'insensitive' } },
        {
          variants: {
            some: { questionText: { contains: escaped, mode: 'insensitive' } },
          },
        },
      ],
    });
  }

  const variantWhere = {};
  if (difficulties.length > 0) {
    variantWhere.difficulty = { in: difficulties };
  }
  if (reasoningLevels.length > 0) {
    variantWhere.reasoningLevel = { in: reasoningLevels };
  }
  if (aiGenerated === 'ai') {
    variantWhere.isAiGenerated = true;
  } else if (aiGenerated === 'not-ai') {
    variantWhere.isAiGenerated = false;
  }
  if (draftStatus === 'draft') {
    variantWhere.isDraft = true;
  } else if (draftStatus === 'reviewed') {
    variantWhere.isDraft = false;
  }

  if (Object.keys(variantWhere).length > 0) {
    and.push({ variants: { some: variantWhere } });
  }

  let orderBy;
  switch (sortBy) {
    case 'oldest':
      orderBy = [{ createdAt: 'asc' }, { id: 'asc' }];
      break;
    case 'type':
      orderBy = [{ type: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }];
      break;
    case 'newest':
    default:
      orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
      break;
  }

  const where =
    and.length === 0 ? {} : and.length === 1 ? and[0] : { AND: and };
  return { where, orderBy };
}
