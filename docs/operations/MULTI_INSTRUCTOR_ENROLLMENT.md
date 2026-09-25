# Adding an instructor to an existing course

**Status:** the common case is now the course page. Tracked by
[#1839](https://github.com/EduAI-Lab/EduAI/issues/1839). [#1840](https://github.com/EduAI-Lab/EduAI/issues/1840)
shipped **Add instructor** on the Staff tab. Use that. The API steps below are
the fallback for when you are not in the UI, plus the record of how the first
ones were done.

---

## When you need this

Use this procedure to add a **second or third instructor** to a course that already
exists, without removing the current one.

Do it from the course page. Open the course, go to the **Staff** tab, and use
**Add instructor** (ADMIN or UNIT_ADMIN). The helper text on that control says
adding someone does not remove anyone. The first instructor added to a course
with no head becomes the primary. **Make primary** only moves `Course.instructorId`.

The old **Replace** control is gone. It used to deactivate the sitting instructor
before writing the new one. A deactivated instructor row in the verify script is
a leftover from that control, not from **Add instructor**.

The sections after this are the API fallback: same end state, for a console
session when you are not on the course page. `Enrollment` still supports any
number of active `INSTRUCTOR` rows, and `addEnrollment` does not inspect the
target's platform role.

## Read this before you start: what an enrollment does and does not buy

Adding an `INSTRUCTOR` enrollment makes someone **instructor of record**. It grants
course access through `resolveCourseAccess`, includes them in the roster, and flows to
AI Tutor via `enrollmentSync`.

**It does not change what the account may do.** `resolveCourseAccess` still decides by
platform role *first*:

```ts
if (user.role === "ADMIN") return { course, access: LEVELS.admin };
```

The enrollment row is never read for an ADMIN, and an in-unit `UNIT_ADMIN`
short-circuits to `unit` the same way. Both outrank `instructor`, so the enrollment
adds no authority they did not already have.

**What it does now buy is the instructor surface.**
[#1843](https://github.com/EduAI-Lab/EduAI/issues/1843) removed the blanket ADMIN
exclusion that used to sit in `listMyPublishedInstructorCourses`. `/instructor/chat`
and `/api/chat`'s instructor-mode guard now share one decision —
`canUseInstructorChatMode` in
[`app/lib/rbac/instructor-view.server.ts`](../../apps/core/app/lib/rbac/instructor-view.server.ts) —
which admits an ADMIN or `UNIT_ADMIN` holding a **real active `INSTRUCTOR`
enrollment** on a **published** course. An account without that enrollment still gets
an empty course list and a 403, exactly as before.

So, concretely:

| Their platform role | After you add the enrollment |
| --- | --- |
| `INSTRUCTOR` | Full instructor surface, including `/instructor/chat` for that course. |
| `ADMIN` | Instructor of record everywhere a roster is read, full `admin` access to the course, **and** `/instructor/chat` for that course, marked with the instructor-view banner. |
| `UNIT_ADMIN`, course in their units | Same as ADMIN: resolves to `unit` for authorization, and reaches the instructor surface through the enrollment. |
| `UNIT_ADMIN`, course outside their units | Falls through to the enrollment, so it behaves as `instructor` throughout. |

One login is now enough: the enrollment is what carries the instructor surface, so
there is no longer a reason to issue a second `INSTRUCTOR` account to someone who
already has an admin one. Note that the course must be **published** before
`/instructor/chat` will list it, whatever the platform role.

## Prerequisites

- A real **ADMIN browser session** on the target environment. `x-api-key` does not
  work: `enableSessionForAPIKeys` is `false`
  ([`app/lib/auth/server.ts`](../../apps/core/app/lib/auth/server.ts)) and the
  enrollments route never calls `enforceAdminIfApiKey`, so the POST half has no
  service-key path at all. The `EDUAI_API_KEY` service key is accepted on the **GET**
  half only, via `Authorization: Bearer`.
- The commands below are run **from the browser console on the app's own origin**, so
  the root `CROSS_ORIGIN_MUTATION` middleware sees a same-site `Origin`. A `fetch`
  typed into the console of a different tab will be rejected with `403 CROSS_ORIGIN_MUTATION`.
- Rank ≥ 3 (ADMIN or UNIT_ADMIN) — `requiredRankForEnrollmentRole` returns `3` for
  `INSTRUCTOR`. An INSTRUCTOR-ranked caller gets `403`.
- Everyone you are adding already has an account. `addEnrollment` answers
  `422 USER_NOT_FOUND` otherwise; invite them at `/admin/invitations` first and wait
  for them to accept.

### Do not use raw SQL

An `INSERT` into `enrollments` reaches the same end state while skipping the
`ENROLLMENT_ADDED` audit row, the instructor-floor invariant and the idempotency
record. There is no time saved that is worth losing the audit trail of who changed a
course's teaching staff.

---

## Procedure

### 1. Identify the right course

Course codes are not unique on their own — a duplicate offering is exactly what
prompted this runbook. From `apps/core`:

```bash
EDUAI_BASE_URL=https://<host> EDUAI_API_KEY=<service key> \
  npx tsx scripts/verify-course-instructors.ts --code "DATA 301"
```

This is read-only. It prints every **live** course with that code, each one's id, its
active instructors, TAs and student count, and any *deactivated* staff rows — a
deactivated instructor is the fingerprint of someone having used the Replace button.
If more than one course matches, it says so; settle which is the real offering before
touching anything.

Soft-deleted courses are not returned. To see those you need `?includeDeleted=true` on
`GET /api/courses` as an ADMIN session.

### 2. Collect the user ids

In the browser console, on the app's origin, signed in as ADMIN:

```js
const findUser = async (q) => {
  const res = await fetch(`/api/users?search=${encodeURIComponent(q)}&page=1&pageSize=10`);
  const body = await res.json();
  return body.data.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role }));
};

console.table(await findUser("mostafa"));
```

Note each person's `role` as well as their `id` — that is the column the table in
"what an enrollment does and does not buy" turns on.

### 3. Add each instructor

Still in the console. One call per person; the course keeps every instructor it
already had.

```js
const addInstructor = async (courseId, userId) => {
  const res = await fetch(`/api/courses/${courseId}/enrollments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Optional but recommended: makes a retry after a flaky response a no-op
      // rather than a second attempt (the route wraps this in withIdempotency).
      "Idempotency-Key": `add-instructor-${courseId}-${userId}`,
    },
    body: JSON.stringify({ userId, role: "INSTRUCTOR" }),
  });
  console.log(res.status, await res.json());
};

await addInstructor("<courseId>", "<userId>");
```

`201` is success. It creates an **additional** active `INSTRUCTOR` enrollment, leaves
`Course.instructorId` and every other enrollment untouched, and writes an
`ENROLLMENT_ADDED` audit row.

### 4. Verify

```bash
EDUAI_BASE_URL=https://<host> EDUAI_API_KEY=<service key> \
  npx tsx scripts/verify-course-instructors.ts --course <courseId> \
    --expect-instructors first@ubc.ca,second@ubc.ca,third@ubc.ca \
    --expect-tas ta@ubc.ca
```

The script exits non-zero if any expected enrollment is missing or inactive, so it can
gate the rest of the change. Check that the instructor count went **up** and that
nobody moved into the deactivated list.

### 5. Confirm the surface they actually need

- Platform-role `INSTRUCTOR`: have them open `/instructor/chat` and confirm the course
  is in the picker. It requires the course to be **published** as well as the
  enrollment to be active.
- Platform-role `ADMIN` or `UNIT_ADMIN`: since
  [#1843](https://github.com/EduAI-Lab/EduAI/issues/1843) they use the same check —
  have them open `/instructor/chat` and confirm the course is in the picker and that
  the instructor-view banner is shown. If the picker is empty, the enrollment is
  inactive or the course is unpublished; a redirect to `/dashboard` means they teach
  nothing published at all. Also confirm the course appears under `/courses`.

### 6. Remove a duplicate course, if there is one

Only after step 1 has established which offering is real, and after confirming with
whoever owns the course. Deletion is a soft delete, and the course keeps its
enrollments, materials, chunks and embeddings.

Since [#1842](https://github.com/EduAI-Lab/EduAI/issues/1842), the course identity slot
is a partial unique index predicated on `deletedAt IS NULL`, so deleting a duplicate
**no longer burns** its code + section + start date — the same course can be created
again afterwards. Before that change, deleting was irreversible in that sense; if you
are working against an environment that has not yet deployed #1842, do not delete
anything you may need to re-create.

---

## Appendix: the whole procedure as one paste

Steps 1–4 above, as three console functions. Paste the block into the browser console on
the target origin while signed in as an **ADMIN**. Steps 1 and 2 are read-only; step 3 is
the only one that writes, and it adds — it can never remove anyone.

This does **not** delete anything. Removing a duplicate course is a separate, deliberate
decision (see step 6), and irreversible in the sense that matters until
[#1842](https://github.com/EduAI-Lab/EduAI/issues/1842) is deployed.

```js
// ── EduAI course-staff helpers (#1839) ───────────────────────────────────────
const api = async (path, init) => {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, ok: res.ok, body: await res.json().catch(() => null) };
};

// Course codes are written inconsistently ("DATA301" vs "DATA 301").
const sameCode = (a, b) => a.replace(/\s+/g, "").toUpperCase() === b.replace(/\s+/g, "").toUpperCase();

// STEP 1 (read-only) — which offering is the real one?
async function auditCourses(code = "DATA 301") {
  const { body } = await api(`/api/courses?search=${encodeURIComponent(code.split(/\s+/)[0])}&page=1&pageSize=200`);
  const matches = (body?.data ?? []).filter((c) => sameCode(c.code, code));
  if (matches.length === 0) return console.warn(`No live course matched ${code}.`);

  const rows = [];
  for (const course of matches) {
    const [detail, tas] = await Promise.all([
      api(`/api/courses/${course.id}`),
      api(`/api/courses/${course.id}/tas`),
    ]);
    // `instructor` is populated only after #1841; fall back to resolving the id.
    let instructor = detail.body?.instructor ?? null;
    const instructorId = detail.body?.instructorId ?? null;
    if (!instructor && instructorId) {
      const u = await api(`/api/users?ids=${encodeURIComponent(instructorId)}`);
      instructor = u.body?.data?.[0] ?? null;
    }
    rows.push({
      id: course.id,
      code: course.code,
      section: course.section ?? "—",
      offering: `${course.term ?? "?"} ${course.year ?? "?"}`,
      published: course.isPublished,
      instructorOfRecord: instructor ? `${instructor.name} <${instructor.email ?? "?"}>` : "(none)",
      TAs: (tas.body?.tas ?? []).map((t) => t.user?.name).join(", ") || "(none)",
    });
  }
  console.table(rows);
  console.log(
    matches.length > 1
      ? `⚠ ${matches.length} live offerings share this code. Pick the one whose instructor and TAs match, and confirm before touching the other.`
      : "One live offering — nothing to disambiguate.",
  );
  console.log("Soft-deleted offerings are not listed. As ADMIN, add &includeDeleted=true to GET /api/courses to see tombstones.");
  return rows;
}

// STEP 2 (read-only) — find the accounts, and note their PLATFORM role.
async function findPeople(...queries) {
  const rows = [];
  for (const q of queries) {
    const { body } = await api(`/api/users?search=${encodeURIComponent(q)}&page=1&pageSize=10`);
    for (const u of body?.data ?? []) {
      rows.push({ searchedFor: q, id: u.id, name: u.name, email: u.email, platformRole: u.role });
    }
  }
  console.table(rows);
  console.log("Platform role matters: see the table in this runbook for which surface each one gets.");
  return rows;
}

// STEP 3 (WRITES) — adds instructors. Removes nobody, demotes nobody.
async function addInstructors(courseId, ...userIds) {
  for (const userId of userIds) {
    const r = await api(`/api/courses/${courseId}/enrollments`, {
      method: "POST",
      // Makes a retry after a flaky response a no-op rather than a second attempt.
      headers: { "Idempotency-Key": `add-instructor-${courseId}-${userId}` },
      body: JSON.stringify({ userId, role: "INSTRUCTOR" }),
    });
    if (r.status === 201) console.log(`✓ ${userId} is now an INSTRUCTOR on ${courseId}`);
    else console.error(`✗ ${userId}: ${r.status}`, r.body);
  }
}
```

Then, in order:

```js
await auditCourses("DATA 301");        // note the id of the real offering
await findPeople("mostafa", "fahd");   // note their user ids and platform roles
await addInstructors("<courseId>", "<mostafaUserId>", "<fahdUserId>");
```

Re-run `auditCourses("DATA 301")` afterwards. Note that until
[#1841](https://github.com/EduAI-Lab/EduAI/issues/1841) is deployed the course endpoints
expose only the single instructor of record, so the added instructors confirm through the
`201` responses rather than through a list; after it deploys, `instructors` on
`GET /api/courses/:id` shows all of them. The
`scripts/verify-course-instructors.ts` check in this repo reads the full set today via
the service key, from outside the browser.

## Errors you may hit

| Response | Meaning | What to do |
| --- | --- | --- |
| `403 CROSS_ORIGIN_MUTATION` | The `fetch` did not come from the app's own origin. | Run it from the console of a tab open on that origin. |
| `401 Unauthorized` | No session cookie. A service key cannot substitute here. | Sign in as ADMIN in the browser. |
| `403 Forbidden` | Caller rank < 3, or a UNIT_ADMIN acting outside their `authorizedUnits`. | Use an ADMIN account, or an in-unit UNIT_ADMIN. |
| `422 USER_NOT_FOUND` | No account for that user id. | Invite them at `/admin/invitations` and wait for acceptance. |
| `422 VALIDATION_ERROR` | `userId` or `role` missing/invalid in the body. | `role` must be exactly `"INSTRUCTOR"`. |
| `409 ALREADY_ENROLLED` | An **active** enrollment already exists for that user on that course. | Nothing to do — check the role is the one you wanted. |
| `409 INSTRUCTOR_FLOOR_VIOLATION` | You tried to remove or demote the last active instructor. | Add the replacement first, then remove. Enforced for every caller including ADMIN, with no override. |

A user who was previously **removed** (an inactive row) is reactivated rather than
409'd — `addEnrollment` catches the `P2002` and flips `isActive` back on with the
requested role. A user who already holds a `TA` or `STUDENT` enrollment on the course
is **promoted** in place, because `@@unique([courseId, userId])` allows one role per
course per user.

---

## Related

- [#1838](https://github.com/EduAI-Lab/EduAI/issues/1838) — parent: one login, many roles
- [#1840](https://github.com/EduAI-Lab/EduAI/issues/1840) — the UI that replaces this procedure
- [#1841](https://github.com/EduAI-Lab/EduAI/issues/1841) — showing every instructor, not just `Course.instructorId`
- [#1842](https://github.com/EduAI-Lab/EduAI/issues/1842) — soft-deleted courses and the identity slot
- [#1843](https://github.com/EduAI-Lab/EduAI/issues/1843) — the admin/instructor view switch
- [#1782](https://github.com/EduAI-Lab/EduAI/issues/1782) — ADMIN accounts in the create-course instructor picker
