/**
 * Shared Core `fetch` stub for QM integration tests after #1114 fail-closed
 * access: ownership alone no longer grants instructor access, so stubs must
 * answer enrollment + cookie-scoped course list with a teaching role.
 *
 * Usage (after seeding courses for `user`):
 *   vi.stubGlobal('fetch', await teachingInstructorFetch(user, prisma));
 *
 * Or wrap a custom handler:
 *   vi.stubGlobal('fetch', await teachingInstructorFetch(user, prisma, { handlers }));
 */
/** #1041: Core's course list answers with `{ data, total, page, pageSize }`. */
function coursePage(rows) {
  return { data: rows, total: rows.length, page: 1, pageSize: 100 };
}

/**
 * @param {{ id: string, email?: string, role?: string, name?: string }} user
 * @param {{ course: { findMany: Function } }} prisma
 * @param {{ handlers?: (url: string|URL, opts?: object) => Promise<object|null|undefined> }} [opts]
 */
export async function teachingInstructorFetch(user, prisma, { handlers } = {}) {
  const courses = await prisma.course.findMany({ where: { userId: user.id } });
  const coreCourses = courses
    .filter((c) => c.coreCourseId)
    .map((c) => ({
      id: c.coreCourseId,
      callerEnrollmentRole: 'INSTRUCTOR',
      name: `Stub ${c.coreCourseId}`,
      code: 'STUB',
      department: 'COSC',
    }));
  const coreById = new Map(coreCourses.map((c) => [c.id, c]));

  return async (url, opts) => {
    if (handlers) {
      const custom = await handlers(url, opts);
      if (custom != null) return custom;
    }

    const target = String(url);
    const path = target.split('?')[0];

    if (path.endsWith('/api/sessions/validate')) {
      return { ok: true, json: async () => ({ user }) };
    }

    const enrollMatch = path.match(/\/api\/courses\/([^/]+)\/enrollments$/);
    if (enrollMatch) {
      return {
        ok: true,
        json: async () => ({
          enrollments: [{ studentId: user.id, role: 'INSTRUCTOR', isActive: true }],
        }),
      };
    }

    if (path.endsWith('/api/courses')) {
      // `?ids=` lookups and full list walks both land here.
      const idsParam = new URL(target).searchParams.get('ids');
      if (idsParam) {
        const ids = idsParam.split(',').filter(Boolean);
        const rows = ids.map((id) => coreById.get(id) ?? { id, name: 'Stub', code: 'STUB' });
        return { ok: true, json: async () => coursePage(rows) };
      }
      return { ok: true, json: async () => coursePage(coreCourses) };
    }

    const detailMatch = path.match(/\/api\/courses\/([^/]+)$/);
    if (detailMatch) {
      const row = coreById.get(detailMatch[1]) ?? {
        id: detailMatch[1],
        name: 'Stub',
        code: 'STUB',
        department: 'COSC',
      };
      return { ok: true, json: async () => row };
    }

    return { ok: true, json: async () => ({}) };
  };
}

export { coursePage };
