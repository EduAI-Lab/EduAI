# Issue #813 Integration Test Backlog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satisfy GitHub #813 by adding Core enrollment soft-delete + policy integration coverage, aligning PATCH/DELETE with the enrollments policy gate, verifying AI Tutor remove write-through tests, fixing any drifting courses/invitations integration assertions, and updating `TESTS.md`.

**Architecture:** Extend existing harnesses. Soft-delete and policy cases go in `courses.enrollments.integration.test.ts` using real Postgres + `setPolicy` / RBAC seed helpers. Wire `manageEnrollments` policy onto PATCH/DELETE in `courses.enrollments.$enrollmentId.ts` (POST already gated). AT write-through is already covered in `admin.test.js` (#812) with mocked Core client — verify and document, don't duplicate.

**Tech Stack:** Vitest (Core unit + integration), Prisma/`SystemConfig` policies, Express/supertest (AI Tutor `admin.test.js`), `docs/TESTS.md`.

**Spec:** `docs/superpowers/specs/2026-08-14-issue-813-integration-test-backlog-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `apps/core/app/routes/api/courses.enrollments.$enrollmentId.ts` | Add `resolvePolicyGate` + `getPolicy` / `denyByPolicy` for PATCH and DELETE (mirror POST add) |
| `apps/core/app/tests/unit/courses.enrollments.enrollmentId.test.ts` | Unit tests for the new policy gate |
| `apps/core/app/tests/integration/courses.enrollments.integration.test.ts` | Soft-delete + roster hide; policy add/update integration |
| `apps/extensions/ai-tutor/server/tests/integration/admin.test.js` | Verify #812 write-through block (edit only if gap) |
| `apps/core/app/tests/integration/courses.integration.test.ts` | Drift fixes only if failing |
| `apps/core/app/tests/integration/invitations.integration.test.ts` | Drift fixes only if failing |
| `TESTS.md` | Inventory updates |
| `CHANGELOG.md` | Brief entry for #813 |

---

### Task 1: Policy gate on PATCH/DELETE (TDD)

**Files:**
- Modify: `apps/core/app/routes/api/courses.enrollments.$enrollmentId.ts`
- Modify: `apps/core/app/tests/unit/courses.enrollments.enrollmentId.test.ts`

- [ ] **Step 1: Add policy mocks + failing unit tests**

In `courses.enrollments.enrollmentId.test.ts`, mock policy like the POST suite:

```ts
vi.mock("~/lib/policy.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/policy.server")>();
  return {
    ...actual,
    getPolicy: vi.fn(async (key: keyof typeof actual.POLICY_FLAGS) => actual.POLICY_FLAGS[key].default),
    denyByPolicy: vi.fn(({ policyKey }: { policyKey: string }) =>
      new Response(JSON.stringify({ error: "Forbidden", policyKey }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  };
});
```

Import `getPolicy` and `denyByPolicy`. In `beforeEach`, reset `getPolicy` to defaults.

Add:

```ts
describe("instructors.canManageEnrollments gate", () => {
  it("returns 403 for INSTRUCTOR PATCH when policy is off", async () => {
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(makeArgs("PATCH", { role: "TA" }));
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("instructors.canManageEnrollments");
    expect(updateEnrollmentRole).not.toHaveBeenCalled();
  });

  it("returns 403 for INSTRUCTOR DELETE when policy is off", async () => {
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(makeArgs("DELETE"));
    expect(res.status).toBe(403);
    expect(deactivateEnrollment).not.toHaveBeenCalled();
  });

  it("ADMIN PATCH succeeds even when policy is off", async () => {
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(makeArgs("PATCH", { role: "TA" }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run unit tests — expect FAIL**

```bash
cd apps/core
npx vitest run app/tests/unit/courses.enrollments.enrollmentId.test.ts
```

Expected: new cases fail (policy never consulted / mutations still run).

- [ ] **Step 3: Implement gate in the route**

After the manage-tier rank check (`access.rank < 2`) and **before** `getEnrollment`, add (same pattern as POST in `courses.enrollments.ts`):

```ts
import { resolvePolicyGate } from "~/lib/rbac";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";

// ...
const enrollmentGate = resolvePolicyGate(access.level, "manageEnrollments");
if (
  enrollmentGate !== "always" &&
  enrollmentGate !== "never" &&
  !(await getPolicy(enrollmentGate))
) {
  return denyByPolicy({
    request,
    policyKey: enrollmentGate,
    user: session.user,
    action: request.method === "PATCH" ? "enrollment.update" : "enrollment.remove",
    courseId,
  });
}
```

Keep existing INSTRUCTOR-peer and instructor-floor checks after the policy gate.

- [ ] **Step 4: Re-run unit file — expect PASS**

```bash
cd apps/core
npx vitest run app/tests/unit/courses.enrollments.enrollmentId.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/core/app/routes/api/courses.enrollments.$enrollmentId.ts apps/core/app/tests/unit/courses.enrollments.enrollmentId.test.ts
git commit -m "fix(core): gate enrollment PATCH/DELETE on canManageEnrollments (#813)"
```

---

### Task 2: Integration — soft-delete + session roster hide

**Files:**
- Modify: `apps/core/app/tests/integration/courses.enrollments.integration.test.ts`

- [ ] **Step 1: Add failing integration case**

Append a new `describe` (or `it`) that uses `seedUser` / `seedCourse` / `enroll` / `cleanupRbac` from `../helpers/rbac` (same pattern as the instructor-floor lifecycle test). Dynamically import `enrollmentIdAction` and `loader`.

```ts
it("DELETE soft-deactivates a student and hides them from the session roster (#813)", async () => {
  const { seedUser, seedCourse, enroll, cleanupRbac, mockSession } = await import(
    "../helpers/rbac"
  );
  const { action: enrollmentIdAction } = await import(
    "~/routes/api/courses.enrollments.$enrollmentId"
  );

  const instructor = await seedUser({ role: "INSTRUCTOR" });
  const student = await seedUser({ role: "STUDENT" });
  const course = await seedCourse();
  await enroll(course.id, instructor.id, "INSTRUCTOR");
  const studentEnrollment = await enroll(course.id, student.id, "STUDENT");

  try {
    mockSession(instructor);
    const deleted = await enrollmentIdAction({
      request: new Request(
        `http://localhost/api/courses/${course.id}/enrollments/${studentEnrollment.id}`,
        { method: "DELETE" },
      ),
      params: { id: course.id, enrollmentId: studentEnrollment.id },
      context: {} as never,
    } as any);
    expect(deleted.status).toBe(204);

    const row = await prisma.enrollment.findUnique({
      where: { id: studentEnrollment.id },
    });
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(false);

    mockSession(instructor);
    const list = await loader({
      request: new Request(`http://localhost/api/courses/${course.id}/enrollments`),
      params: { id: course.id },
      context: {} as never,
    } as any);
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.enrollments.every((e: { studentId: string }) => e.studentId !== student.id)).toBe(
      true,
    );
    expect(body.total).toBe(0);
  } finally {
    await cleanupRbac({
      userIds: [instructor.id, student.id],
      courseIds: [course.id],
    });
  }
});
```

Adjust imports if `mockSession` is already imported at file top via `auth` mocking — reuse the file’s existing `mockSession` helper if present; otherwise use the rbac helper.

- [ ] **Step 2: Run the integration file (or the single test)**

```bash
cd apps/core
npx vitest run --config vitest.integration.config.ts app/tests/integration/courses.enrollments.integration.test.ts
```

Requires `TEST_DATABASE_URL` / Docker test DB (same as other Core integration suites). Expected: new test passes if soft-delete already works; if `total`/`enrollments` shape differs, fix assertions to match `pagedEnrollmentsResponse`.

- [ ] **Step 3: Commit**

```bash
git add apps/core/app/tests/integration/courses.enrollments.integration.test.ts
git commit -m "test(core): cover enrollment soft-delete and roster hide (#813)"
```

---

### Task 3: Integration — add/update policy gates

**Files:**
- Modify: `apps/core/app/tests/integration/courses.enrollments.integration.test.ts`

- [ ] **Step 1: Write policy integration cases**

Use real `setPolicy` / `invalidatePolicyCache` (do **not** mock `policy.server` in this file — other cases need defaults):

```ts
it("INSTRUCTOR add/update denied when instructors.canManageEnrollments is off; ADMIN still ok (#813)", async () => {
  const { setPolicy, invalidatePolicyCache } = await import("~/lib/policy.server");
  const { seedUser, seedCourse, enroll, cleanupRbac, mockSession } = await import(
    "../helpers/rbac"
  );
  const { action: enrollmentsAction } = await import("~/routes/api/courses.enrollments");
  const { action: enrollmentIdAction } = await import(
    "~/routes/api/courses.enrollments.$enrollmentId"
  );

  const admin = await seedUser({ role: "ADMIN" });
  const instructor = await seedUser({ role: "INSTRUCTOR" });
  const student = await seedUser({ role: "STUDENT" });
  const student2 = await seedUser({ role: "STUDENT" });
  const course = await seedCourse();
  await enroll(course.id, instructor.id, "INSTRUCTOR");
  const existing = await enroll(course.id, student.id, "STUDENT");

  await setPolicy("instructors.canManageEnrollments", false, admin.id);

  try {
    mockSession(instructor);
    const deniedAdd = await enrollmentsAction({
      request: new Request(`http://localhost/api/courses/${course.id}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: student2.id, role: "STUDENT" }),
      }),
      params: { id: course.id },
      context: {} as never,
    } as any);
    expect(deniedAdd.status).toBe(403);

    mockSession(instructor);
    const deniedPatch = await enrollmentIdAction({
      request: new Request(
        `http://localhost/api/courses/${course.id}/enrollments/${existing.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "TA" }),
        },
      ),
      params: { id: course.id, enrollmentId: existing.id },
      context: {} as never,
    } as any);
    expect(deniedPatch.status).toBe(403);

    mockSession(admin);
    const adminAdd = await enrollmentsAction({
      request: new Request(`http://localhost/api/courses/${course.id}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: student2.id, role: "STUDENT" }),
      }),
      params: { id: course.id },
      context: {} as never,
    } as any);
    expect(adminAdd.status).toBe(201);
  } finally {
    await setPolicy("instructors.canManageEnrollments", true, admin.id);
    invalidatePolicyCache();
    await cleanupRbac({
      userIds: [admin.id, instructor.id, student.id, student2.id],
      courseIds: [course.id],
    });
  }
});
```

- [ ] **Step 2: Run integration enrollments suite — expect PASS**

```bash
cd apps/core
npx vitest run --config vitest.integration.config.ts app/tests/integration/courses.enrollments.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/app/tests/integration/courses.enrollments.integration.test.ts
git commit -m "test(core): integration coverage for enrollment policy gates (#813)"
```

---

### Task 4: Verify AI Tutor remove write-through (#812)

**Files:**
- Possibly modify: `TESTS.md` only
- Touch `admin.test.js` only if a gap is found

- [ ] **Step 1: Run existing write-through tests**

```bash
cd apps/extensions/ai-tutor/server
npx vitest run --config vitest.integration.config.js tests/integration/admin.test.js -t "DELETE …/enrollments/:userId on EduAI-linked"
```

(Adjust vitest config path if the package uses a different integration config — match how other AT integration tests are run in this repo.)

Expected: the three cases under `DELETE …/enrollments/:userId on EduAI-linked course` pass (Core called, Core failure leaves local, missing Core enrollment → 404).

- [ ] **Step 2: If all pass, update TESTS.md wording for `admin.test.js` to explicitly mention #812 / #813 remove write-through (Core-first, local abort on Core failure). If a gap exists (e.g. no assert that Core is called before local delete), add one focused assertion test — do not rewrite the suite.**

- [ ] **Step 3: Commit if anything changed**

```bash
git add TESTS.md apps/extensions/ai-tutor/server/tests/integration/admin.test.js
git commit -m "test(ai-tutor): document enrollment remove write-through coverage (#813)"
```

---

### Task 5: Drift check — courses + invitations integration

**Files:**
- Modify only if failing: `apps/core/app/tests/integration/courses.integration.test.ts`, `apps/core/app/tests/integration/invitations.integration.test.ts`

- [ ] **Step 1: Run both suites**

```bash
cd apps/core
npx vitest run --config vitest.integration.config.ts app/tests/integration/courses.integration.test.ts app/tests/integration/invitations.integration.test.ts
```

- [ ] **Step 2: If green, skip code changes.** If failures match known drift (`422` vs older status, `VALIDATION_ERROR`, invite rollback), update expectations/fixtures to match current API envelopes — no product behavior changes unless a real bug is confirmed.

- [ ] **Step 3: Commit only if files changed**

```bash
git add apps/core/app/tests/integration/courses.integration.test.ts apps/core/app/tests/integration/invitations.integration.test.ts
git commit -m "test(core): align courses/invitations integration assertions (#813)"
```

---

### Task 6: TESTS.md + CHANGELOG + final verification

**Files:**
- Modify: `TESTS.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update TESTS.md rows** for:
  - `courses.enrollments.integration.test.ts` — soft-delete + roster hide; policy add/update
  - `courses.enrollments.enrollmentId.test.ts` — `canManageEnrollments` on PATCH/DELETE
  - `admin.test.js` — #812/#813 write-through (if not already explicit)

- [ ] **Step 2: Add CHANGELOG entry** under Unreleased, e.g.:

```markdown
- [core][ai-tutor][testing] Close #813 integration backlog: enrollment soft-delete + roster hide, `canManageEnrollments` on PATCH/DELETE, policy integration coverage, AT remove write-through docs. (@GlowyBlack, 2026-08-14) - [#813](...)
```

(Use the eventual PR number once opened.)

- [ ] **Step 3: Final verification**

```bash
cd apps/core
npx vitest run app/tests/unit/courses.enrollments.enrollmentId.test.ts app/tests/unit/courses.enrollments.test.ts
npx vitest run --config vitest.integration.config.ts app/tests/integration/courses.enrollments.integration.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add TESTS.md CHANGELOG.md
git commit -m "docs: inventory #813 enrollment integration coverage"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| R1 soft-delete + session roster hide | Task 2 |
| R2 add/update policy (+ product gate on PATCH/DELETE) | Tasks 1 + 3 |
| R3 AT write-through | Task 4 |
| R4 courses/invitations drift | Task 5 |
| R5 TESTS.md | Tasks 4 + 6 |

## Self-review notes

- No placeholders left in task steps.
- Policy on DELETE included because policy-flag copy says “add/remove”; AC said “add/update” — PATCH is required; DELETE gate is intentional alignment with flag description.
- AT suite already implements the chosen harness (mocked Core client); plan verifies rather than reimplements.
