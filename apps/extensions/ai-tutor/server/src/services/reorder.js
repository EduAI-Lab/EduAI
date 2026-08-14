/**
 * @file Single-row move-to-position reordering for the ordered tree levels.
 *
 * Responsibility: move one module / lesson / activity to an absolute ordinal
 *   within its sibling scope, atomically, without the caller holding the full
 *   sibling list.
 *
 * Why this exists (#1207): the bulk `PUT .../order` endpoints take the complete
 * ordered id set and reassign `0..n-1`. That is correct only when the client
 * has every sibling in memory, which stopped being true once the tree lists got
 * a real pager — a drag on page 3 would otherwise persist a partial order and
 * orphan everything the client never loaded. The bulk endpoints stay for the
 * single-page case; this is what a paged drag and the "Move to position…"
 * affordance call.
 *
 * The `position` a caller sends is a 0-based ORDINAL — an index into the
 * ordered sibling list — not a raw `position` column value. Those coincide only
 * when the column happens to be contiguous, which it need not be: `POST` append
 * uses `last.position + 1` and rows get deleted, so gaps are normal. Resolving
 * the ordinal against the actual ordered list (rather than trusting the column
 * to be a rank) is what makes "move to #247" mean the same thing to the user
 * and to the database.
 *
 * Related: `server/src/utils/pagination.js`, `app/lib/api.ts`
 * (`moveModuleToPosition` and friends).
 */

import { prisma } from '../config/database.js';

/**
 * A 4xx-shaped error thrown for a caller mistake. Routes translate this the
 * same way they translate `PaginationError`.
 */
export class ReorderError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ReorderError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Validate a `position` from a request body as a 0-based ordinal.
 *
 * Out-of-range values are CLAMPED by `moveToPosition` rather than rejected:
 * "move to the end" is naturally expressed as a big number, and a concurrent
 * delete shouldn't turn a legitimate drag into an error. Non-integers are a
 * caller bug and 400.
 *
 * @param {unknown} raw
 * @returns {number}
 * @throws {ReorderError} `POSITION_INVALID`
 */
export function parsePositionBody(raw) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ReorderError(
      'position must be a non-negative integer',
      400,
      'POSITION_INVALID',
    );
  }
  return value;
}

/**
 * Move one row to an absolute ordinal within its sibling scope.
 *
 * Runs in a single transaction:
 *   1. read the sibling ids in canonical order (`position asc, id asc`),
 *   2. splice the moved id out and back in at the clamped target index,
 *   3. write `position = index` for every row whose index changed.
 *
 * Step 3 skips rows already sitting at their index, so a normalized list costs
 * only the band between the old and new ordinal. A list with pre-existing gaps
 * or duplicate positions costs more on the first move and comes out normalized
 * — the operation is self-healing rather than assuming clean data.
 *
 * @param {object} params
 * @param {'module'|'lesson'|'activity'} params.model Prisma delegate name.
 * @param {number} params.id Row to move.
 * @param {object} params.scopeWhere Sibling scope, e.g. `{ moduleId: 4 }`.
 * @param {number} params.targetPosition 0-based ordinal; clamped to the list.
 * @returns {Promise<{ position: number, total: number }>} The resolved ordinal
 *   the row now occupies and the sibling count it was resolved against.
 * @throws {ReorderError} `ROW_NOT_IN_SCOPE` when the id isn't a sibling.
 */
export async function moveToPosition({ model, id, scopeWhere, targetPosition }) {
  return prisma.$transaction(async (tx) => {
    const delegate = tx[model];
    const siblings = await delegate.findMany({
      where: scopeWhere,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true },
    });

    const currentIndex = siblings.findIndex((row) => row.id === id);
    if (currentIndex === -1) {
      throw new ReorderError('Row is not part of this list', 404, 'ROW_NOT_IN_SCOPE');
    }

    const total = siblings.length;
    const nextIndex = Math.min(Math.max(targetPosition, 0), total - 1);

    const reordered = siblings.slice();
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);

    // Written sequentially inside the transaction: `position` carries no unique
    // constraint, so the order of the individual updates doesn't matter, but
    // they must all land or none of them.
    for (const [index, row] of reordered.entries()) {
      if (row.position !== index) {
        await delegate.update({ where: { id: row.id }, data: { position: index } });
      }
    }

    return { position: nextIndex, total };
  });
}
