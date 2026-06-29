import { isValidDisciplineCode, areValidDisciplineCodes } from "~/lib/disciplines/server";

/**
 * Shared discipline-validation guards (§541). Each returns a 400 Response when
 * the code(s) are not known disciplines, or null to continue — so the
 * validate-then-400 shape lives in one place instead of being copy-pasted at
 * every course/user/invitation write site.
 */

function badRequest(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 400,
    headers: { "Content-Type": "application/json" } as const,
  });
}

/** 400 UNKNOWN_DEPARTMENT if `code` is not a known discipline, else null. */
export async function assertValidDepartment(code: string): Promise<Response | null> {
  return (await isValidDisciplineCode(code)) ? null : badRequest("UNKNOWN_DEPARTMENT");
}

/** 400 UNKNOWN_UNIT if any code in `codes` is unknown, else null (empty → null). */
export async function assertValidUnits(codes: string[]): Promise<Response | null> {
  return (await areValidDisciplineCodes(codes)) ? null : badRequest("UNKNOWN_UNIT");
}
