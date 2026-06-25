import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";

/**
 * Disciplines ("units" / UBCO subject codes, §541).
 *
 * Source of truth is the `Discipline` table, seeded from the Workday export
 * (prisma/data/disciplines.csv). This module backs:
 *   - GET /api/disciplines — full list for the department picker
 *   - course `department` / user `authorizedUnits` validation
 *
 * The validation code set is cached in-memory (disciplines change rarely) so we
 * don't hit the DB on every course create / keystroke.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" } as const,
  });

const unauthorized = () => json({ error: "Unauthorized" }, 401);

// ---------------------------------------------------------------------------
// Code-set cache — used by the validators (existence checks only, no labels).
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = Math.min(
  7_200_000, // 2 h ceiling
  Math.max(5_000, Number(process.env.DISCIPLINE_CACHE_TTL_MS) || 3_600_000),
);

let codeCache: { codes: Set<string>; expiresAt: number } | null = null;

async function getCodeSet(): Promise<Set<string>> {
  if (codeCache && codeCache.expiresAt > Date.now()) return codeCache.codes;
  const rows = await prisma.discipline.findMany({ select: { code: true } });
  const codes = new Set(rows.map((r) => r.code));
  codeCache = { codes, expiresAt: Date.now() + CACHE_TTL_MS };
  return codes;
}

/** Drop the cached code set so the next validation reads fresh data. */
export function invalidateDisciplineCache(): void {
  codeCache = null;
}

/** True when `code` is a known discipline. */
export async function isValidDisciplineCode(code: string): Promise<boolean> {
  return (await getCodeSet()).has(code);
}

/** True when every code in `codes` is a known discipline (empty array → true). */
export async function areValidDisciplineCodes(codes: string[]): Promise<boolean> {
  if (codes.length === 0) return true;
  const known = await getCodeSet();
  return codes.every((code) => known.has(code));
}

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

/** GET /api/disciplines — full list (code + name), ordered by code. */
export async function listDisciplines(request: Request): Promise<Response> {
  const session = await auth.api.getSession(request);
  if (!session?.user) return unauthorized();

  const disciplines = await prisma.discipline.findMany({
    select: { code: true, name: true },
    orderBy: { code: "asc" },
  });
  return json({ disciplines });
}
