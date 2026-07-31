# Unit Admin actor

`UNIT_ADMIN` is a platform-level `UserRole` (`packages/types`) that sits between `INSTRUCTOR` and `ADMIN` on the rank ladder (`admin: 4, unit: 3, instructor: 2, ta: 1, student: 0` — `apps/core/app/lib/auth/course-access.server.ts`). Unlike INSTRUCTOR/TA/STUDENT, a UNIT_ADMIN's course access is not resolved from an `Enrollment` row at all (unless they also happen to hold one) — it comes from matching the course's `department` field against their own `authorizedUnits: string[]` column on `User`. `resolveCourseAccessWithCourse` checks this first: `if (course.department !== null && units.includes(course.department)) return { course, access: LEVELS.unit }` (rank 3) — and only falls through to the normal enrollment lookup if that unit match fails, so a UNIT_ADMIN with no unit match but a genuine `Enrollment` on some other course still resolves normally (e.g. as `instructor` if they also teach it).

This unit lock (called out as "§19 unit lock" in the source) is enforced independently in three places that matter for a unit admin's day-to-day work:

1. **Course access** — `resolveCourseAccessWithCourse` (above), used by every course-scoped API route and by the `courses.$courseId.tsx` page loader.
2. **Course listing** — `buildCourseListFilter` (`apps/core/app/lib/auth/course-access.server.ts`) restricts `GET /api/courses` to `{ department: { in: units } } OR <courses the UNIT_ADMIN is personally enrolled in>`.
3. **Course creation/department reassignment** — `createCourse` and `updateCourse` (`apps/core/app/lib/courses/server.ts`) both re-check `units.includes(department)` server-side before writing, so a UNIT_ADMIN cannot create or move a course into a department they aren't authorized for merely by editing a client-side form field.

The other defining UNIT_ADMIN capability is **invitations** — `unit-admin.invitations.tsx` and `api/invitations.ts`/`api/invitations.$id.ts`, gated end-to-end by the `unitAdmins.canInvite` policy flag and by `invitableRolesFor("UNIT_ADMIN")` which returns only `["INSTRUCTOR", "STUDENT"]` (`apps/core/app/lib/invitations/schemas.ts`) — a UNIT_ADMIN can never issue an ADMIN or UNIT_ADMIN invitation, and the route enforces this itself rather than trusting the UI to hide the option.

Rank 3 (`unit`) clears every `access.rank >= 2` (instructor-tier) and `access.rank >= 3` (admin/unit-only) gate documented in `docs/use-cases/core/instructor.md` — a UNIT_ADMIN can reassign instructors, change a course's department, promote/demote enrollments including INSTRUCTOR ones, and manage TAs, on any course inside their authorized units. Only `admin: 4`-gated actions (not found gated anywhere in the routes reviewed here beyond the `includeDeleted` forensics flag) sit above it.

---

### UC-UNITADMIN-001: Unit admin invites a new instructor to their unit

- **Category:** Happy Path
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ["CPSC"]`
- **Preconditions:** `unitAdmins.canInvite` policy flag is on; invited email is not an existing `User`
- **Entry point(s):** `apps/core/app/routes/unit-admin.invitations.tsx`, `apps/core/app/routes/api/invitations.ts`
- **Flow:**
  1. Unit admin opens `/unit-admin/invitations`; the loader redirects to `/dashboard` if the session isn't `UNIT_ADMIN` or if `getPolicy("unitAdmins.canInvite")` is off — otherwise the page renders
  2. Unit admin clicks "Invite User", enters `newprof@cs.ubc.ca`, selects role "Professor (Instructor)", and submits (`POST /api/invitations` with `{ email, role: "INSTRUCTOR" }`)
  3. `requireInviter(request, "invitation.create")` (`apps/core/app/lib/auth/guards.server.ts`) confirms the session role is `ADMIN` or `UNIT_ADMIN`
  4. `createInvitationSchema.safeParse` (`apps/core/app/lib/invitations/schemas.ts`) validates the shape and the UBC-email rule (`isUbcEmail`, `apps/core/app/lib/auth/ubc-email.ts`)
  5. `invitableRolesFor(user.role)` returns `["INSTRUCTOR", "STUDENT"]` for `UNIT_ADMIN`, which includes `"INSTRUCTOR"`, so the role check passes
  6. `createInvitation` (`apps/core/app/lib/invitations/service.server.ts`) confirms no existing `User` with that email, supersedes any prior `PENDING` invite for it, mints a token via `generateInviteToken` (`apps/core/app/lib/invitations/token.server.ts`), and creates an `Invitation` row storing only `tokenHash`
  7. `emailInvite` sends the accept link via `sendEmail`; the route logs `INVITATION_CREATED` (`logAuditAction`)
- **Expected outcome:** `201` with `{ invitation, acceptUrl, emailDelivered: true }`. The new row appears in the unit admin's own invitations list (scoped by `invitedById` — see UC-UNITADMIN-004) with `status: "PENDING"`.
- **Failure modes / what could go wrong:** None on this path — role, policy flag, UBC-domain, and invitable-role checks are all enforced server-side before any DB write.
- **Related code:**
  - `apps/core/app/routes/unit-admin.invitations.tsx`
  - `apps/core/app/routes/api/invitations.ts`
  - `apps/core/app/lib/invitations/service.server.ts`
  - `apps/core/app/lib/invitations/schemas.ts`
  - `apps/core/app/lib/auth/guards.server.ts`

---

### UC-UNITADMIN-002: Unit admin views all courses within their unit

- **Category:** Happy Path
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ["CPSC", "MATH"]`
- **Preconditions:** Several `Course` rows exist with `department: "CPSC"`, `"MATH"`, and other departments
- **Entry point(s):** `apps/core/app/routes/courses.tsx`, `apps/core/app/routes/api/courses.$.ts`
- **Flow:**
  1. Unit admin opens `/courses`; the page loader reads `authorizedUnits` directly from the DB (`prisma.user.findUnique`) since the better-auth session doesn't reliably carry custom array fields
  2. `useCourses` hook fetches `GET /api/courses` → `getCourses` (`apps/core/app/lib/courses/server.ts`) calls `buildCourseListFilter(session.user)` (`apps/core/app/lib/auth/course-access.server.ts`), which for a `UNIT_ADMIN` returns `{ deletedAt: null, OR: [{ department: { in: units } }, ...enrollmentBranches(userId)] }`
  3. `prisma.course.findMany` returns every course in `CPSC`/`MATH` (published or not) plus any course the unit admin happens to be personally enrolled in outside those units
  4. The page renders `CoursesUnitAdminView`, additionally filtering client-side to `courses.filter(c => c.department !== null && authorizedUnits.includes(c.department))` for the primary listing
- **Expected outcome:** `200` with the full course list (including unpublished courses in-unit); the UI shows only in-unit courses in the main table.
- **Failure modes / what could go wrong:** None found — the server-side filter is the authoritative gate; the client-side filter in `courses.tsx` is presentation-only and does not itself restrict what the API already scoped.
- **Related code:**
  - `apps/core/app/routes/courses.tsx`
  - `apps/core/app/routes/api/courses.$.ts`
  - `apps/core/app/lib/courses/server.ts`
  - `apps/core/app/lib/auth/course-access.server.ts`

---

### UC-UNITADMIN-003: Unit admin reassigns an instructor between courses in their unit

- **Category:** Typical Use
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ["CPSC"]`, courseId=42 (`department: "CPSC"`) currently taught by instructor A
- **Preconditions:** Instructor B (a different `User` with `role: "INSTRUCTOR"`) exists
- **Entry point(s):** `apps/core/app/routes/api/courses.id.ts`, `apps/core/app/lib/courses/server.ts`
- **Flow:**
  1. Unit admin opens the course edit form for course 42 and changes the assigned instructor to instructor B, submitting `PATCH /api/courses/42` with `{ instructorId: "<B's id>" }`
  2. `updateCourse` resolves `access = { level: "unit", rank: 3 }` via `resolveCourseAccessWithCourse` (unit match on `CPSC`)
  3. The base gate `access.rank < 2` is false, and the instructor/department-reassignment gate `access.rank < 3` is also false — both `instructorId` and `department` remain in `updateData` for a rank-3 caller (only rank-2 INSTRUCTOR callers get them stripped)
  4. `instructorChanging` is `true` (`newInstructorId !== course.instructorId`); inside a `prisma.$transaction`, the prior instructor A's `Enrollment(role: INSTRUCTOR)` on course 42 is set `isActive: false`, and an `Enrollment` for B is upserted with `role: "INSTRUCTOR", isActive: true`
  5. `course.instructorId` is updated to B in the same transaction
- **Expected outcome:** `200` with the updated `Course` row (`instructorId` now B's id). Instructor A loses `instructor` access to course 42 on their next request (re-resolved from `Enrollment`, not cached); instructor B gains it.
- **Failure modes / what could go wrong:** None found for the reassignment itself. Note the enrollment-count invariant lives in a *different* route (`courses.enrollments.$enrollmentId.ts`'s `updateEnrollmentRole`/`deactivateEnrollment`, which reject an operation that would leave zero active instructors with `409 INSTRUCTOR_FLOOR_VIOLATION`) — `updateCourse`'s direct instructor-swap path does not appear to run that same floor check (it deactivates A unconditionally as part of the swap), though the swap always leaves exactly one active instructor (B) as a side effect, so the floor is never actually violated by this specific flow.
- **Related code:**
  - `apps/core/app/routes/api/courses.id.ts`
  - `apps/core/app/lib/courses/server.ts`
  - `apps/core/app/lib/auth/course-access.server.ts`

---

### UC-UNITADMIN-004: Invitation email fails to send, unit admin retries

- **Category:** Error Recovery
- **Actor:** `UNIT_ADMIN`, SMTP misconfigured or transiently down
- **Preconditions:** `unitAdmins.canInvite` on
- **Entry point(s):** `apps/core/app/routes/api/invitations.ts`, `apps/core/app/lib/email/mailer.server.ts`
- **Flow:**
  1. Unit admin submits an invitation; `createInvitation` reaches `emailInvite` → `sendEmail` (`apps/core/app/lib/email/mailer.server.ts`)
  2. Case A — SMTP not configured (`SMTP_HOST` unset): `getTransport()` returns `null`, `sendEmail` logs to console and returns `{ delivered: false }` without throwing
  3. Case B — SMTP configured but the send fails (network/auth error): `transport.sendMail` throws; `sendEmail`'s catch logs a `MAIL_SEND_FAILED` system error (`logSystemError`) and re-throws; `emailInvite`'s own try/catch swallows it and returns `false`
  4. Either way, `createInvitation` still returns `{ ok: true, invitation, acceptUrl, emailDelivered: false }` — the `Invitation` row was already created before the email attempt
  5. The UI's `handleCreate` shows the fallback notice: `"Invitation created for ... (email not configured — copy the link below)"` with a copy-to-clipboard affordance for `acceptUrl`
  6. To retry delivery, the unit admin uses the row's "Resend / copy link" action (`POST /api/invitations/:id`) → `resendInvitation` (`apps/core/app/lib/invitations/service.server.ts`), which rotates the token (invalidating the previous link), refreshes the expiry, and re-attempts `emailInvite`
- **Expected outcome:** The invitation is never lost to a failed send — it exists in `PENDING` status with a working accept link regardless of `emailDelivered`. Repeated resend attempts are safe (each rotates the token so only the newest link is valid) and are logged (`INVITATION_RESENT`).
- **Failure modes / what could go wrong:** A unit admin who doesn't notice `emailDelivered: false` and doesn't copy the link has no other way to hand the invitee a working URL from the UI shown here except via the same banner/resend flow — there is no separate "view current link" affordance on an already-created row (only resend, which rotates it again). Not a security gap, but a minor UX foot-gun.
- **Related code:**
  - `apps/core/app/routes/api/invitations.ts`
  - `apps/core/app/routes/api/invitations.$id.ts`
  - `apps/core/app/lib/invitations/service.server.ts`
  - `apps/core/app/lib/email/mailer.server.ts`
  - `apps/core/app/routes/unit-admin.invitations.tsx`

---

### UC-UNITADMIN-005: Unit admin submits an invitation with a malformed email

- **Category:** Wrong/Malformed Usage
- **Actor:** `UNIT_ADMIN`
- **Preconditions:** None — a typo or non-UBC address is entered
- **Entry point(s):** `apps/core/app/routes/api/invitations.ts`, `apps/core/app/lib/invitations/schemas.ts`
- **Flow:**
  1. Unit admin types `notreallyanemail` or `prof@gmail.com` into the invite form and submits (`POST /api/invitations`)
  2. `createInvitationSchema.safeParse` runs two checks: the base `z.string().email(...)` shape check, and the `superRefine`'s `isUbcEmail(data.email)` check — `notreallyanemail` fails the former, `prof@gmail.com` passes the shape check but fails `isUbcEmail` (domain is neither `ubc.ca` nor `*.ubc.ca`)
  3. `safeParse` fails; the route returns before ever calling `createInvitation` or touching the DB
  4. The frontend's `errorMessage` helper maps the `"Invalid input"` code through `firstFieldError(details)` (`apps/core/app/lib/form-errors.ts`) to surface the specific Zod issue message (e.g. the `UBC_EMAIL_MESSAGE` string) under the email field
- **Expected outcome:** `400 { error: "Invalid input", details: <zod flatten> }`. No `Invitation` row created, no email sent.
- **Failure modes / what could go wrong:** None found — validation happens before any side effect, and the UI surfaces the specific field-level reason rather than a generic error.
- **Related code:**
  - `apps/core/app/routes/api/invitations.ts`
  - `apps/core/app/lib/invitations/schemas.ts`
  - `apps/core/app/lib/auth/ubc-email.ts`
  - `apps/core/app/routes/unit-admin.invitations.tsx`

---

### UC-UNITADMIN-006: Unit admin attempts to manage a course outside their assigned unit

- **Category:** Malicious/Adversarial
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ["CPSC"]`, targeting courseId=99 with `department: "MATH"`, no personal enrollment on it
- **Preconditions:** Course 99 exists and is not published
- **Entry point(s):** `apps/core/app/routes/api/courses.id.ts`, `apps/core/app/lib/courses/server.ts`, `apps/core/app/lib/auth/course-access.server.ts`
- **Flow:**
  1. Attacker sends `PATCH /api/courses/99` (or `GET`/`DELETE`) directly, e.g. `{ name: "Renamed" }`
  2. `resolveCourseAccessWithCourse` checks `course.department !== null` (true, `"MATH"`) then `units.includes("MATH")` — `false`, since `authorizedUnits` is only `["CPSC"]` — so the unit-match branch does not apply and the function falls through to the normal `Enrollment` lookup
  3. No active `Enrollment` ties this user to course 99, so `access` resolves to `null`
  4. `updateCourse`'s `if (!access || access.rank < 2)` gate returns `403` before any field is touched
  5. Attempting `POST /api/courses` with `{ department: "MATH", ... }` to *create* a new course in that unit instead: `createCourse` explicitly checks `if (session.user.role === "UNIT_ADMIN") { ... if (!units.includes(result.data.department)) return apiError(403, "DEPARTMENT_NOT_AUTHORIZED") }` — rejected before the transaction
- **Expected outcome:** `403 Forbidden` (update/delete/course-scoped reads) or `403 { error: "DEPARTMENT_NOT_AUTHORIZED" }` (create). No row created or modified in either case.
- **Failure modes / what could go wrong:** None found — both the read/update path (`resolveCourseAccessWithCourse`'s unit-then-enrollment fallthrough) and the create path (`createCourse`'s explicit `units.includes` check) independently enforce the same unit boundary; a UNIT_ADMIN cannot widen their own `authorizedUnits` through either surface, since that field is only ever read from the DB (`getAuthorizedUnits`), never taken from the request body.
- **Related code:**
  - `apps/core/app/routes/api/courses.id.ts`
  - `apps/core/app/lib/courses/server.ts`
  - `apps/core/app/lib/auth/course-access.server.ts`

---

### UC-UNITADMIN-007: Unit admin attempts to invite a user with an ADMIN role

- **Category:** Malicious/Adversarial
- **Actor:** `UNIT_ADMIN` with `unitAdmins.canInvite` on
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/api/invitations.ts`, `apps/core/app/lib/invitations/schemas.ts`
- **Flow:**
  1. Attacker crafts `POST /api/invitations` directly (bypassing the UI, which only offers `INSTRUCTOR`/`STUDENT` in its `ROLE_OPTIONS`) with `{ email: "me@cs.ubc.ca", role: "ADMIN" }`
  2. `requireInviter` passes (role is `UNIT_ADMIN`, which is permitted to call this endpoint at all)
  3. `createInvitationSchema.safeParse` passes — `"ADMIN"` is a member of the schema-level `INVITABLE_ROLES` union, so shape validation alone does not reject it
  4. The route's explicit second check fires: `if (!invitableRolesFor(user.role).includes(result.data.role)) return json({ error: "FORBIDDEN_ROLE" }, 403)` — `invitableRolesFor("UNIT_ADMIN")` returns exactly `["INSTRUCTOR", "STUDENT"]`, which does not include `"ADMIN"`
- **Expected outcome:** `403 { error: "FORBIDDEN_ROLE" }`. No `Invitation` row is created — the role-restriction check runs after schema validation but before any `createInvitation` call.
- **Failure modes / what could go wrong:** None found — the restriction is enforced server-side independent of the client form, and is not merely a UI affordance.
- **Related code:**
  - `apps/core/app/routes/api/invitations.ts`
  - `apps/core/app/lib/invitations/schemas.ts`

---

### UC-UNITADMIN-008: Unit admin attempts to manage another unit admin's invitations

- **Category:** Malicious/Adversarial
- **Actor:** `UNIT_ADMIN` A, targeting an invitation created by `UNIT_ADMIN` B
- **Preconditions:** B has a `PENDING` invitation with a known or guessed `id`
- **Entry point(s):** `apps/core/app/routes/api/invitations.$id.ts`, `apps/core/app/lib/invitations/service.server.ts`
- **Flow:**
  1. A sends `DELETE /api/invitations/<B's-invitation-id>` (or `POST` to resend it)
  2. `requireInviter` passes (A is a `UNIT_ADMIN`); the route computes `scope = isAdmin ? undefined : { restrictToInviterId: user.id }` — for A, `restrictToInviterId: A.id`
  3. `revokeInvitation`/`resendInvitation` (`apps/core/app/lib/invitations/service.server.ts`) look up the invitation by `id`, then check `if (opts?.restrictToInviterId && invitation.invitedById !== opts.restrictToInviterId) return { ok: false, status: 404, error: "NOT_FOUND" }` — B's invitation was created by B, not A, so this fires
  4. The response is `404`, not `403` — the code comment notes this is deliberate: "so a non-owner can't probe invite IDs" (distinguishing "exists but forbidden" from "doesn't exist" would let an attacker enumerate valid invitation ids)
- **Expected outcome:** `404 { error: "NOT_FOUND" }`. B's invitation is untouched (not revoked, not resent, token not rotated). Likewise, `GET /api/invitations` for A only ever calls `listInvitations({ invitedById: A.id })`, so B's invitations never appear in A's list to begin with.
- **Failure modes / what could go wrong:** None found — the ownership scope is enforced in the service layer itself (not just the route), and the 404-not-403 choice specifically defeats id enumeration/probing.
- **Related code:**
  - `apps/core/app/routes/api/invitations.$id.ts`
  - `apps/core/app/routes/api/invitations.ts`
  - `apps/core/app/lib/invitations/service.server.ts`

---

### UC-UNITADMIN-009: Invitation token is guessed, reused, or replayed after supersession

- **Category:** Security
- **Actor:** An unauthorized party who does not hold a legitimate invitation, attempting to construct or reuse an accept token
- **Preconditions:** A `PENDING` invitation exists for some third party
- **Entry point(s):** `apps/core/app/lib/invitations/token.server.ts`, `apps/core/app/lib/invitations/service.server.ts`, `apps/core/app/routes/auth/accept-invitation.tsx`
- **Flow (guessing):**
  1. `generateInviteToken` (`apps/core/app/lib/invitations/token.server.ts`) mints the raw token via `randomBytes(32).toString("base64url")` — 256 bits of CSPRNG entropy — and stores only `hashToken(token)` (`sha256` hex digest) as `Invitation.tokenHash`; the raw token is returned exactly once, embedded in the accept URL, and never persisted anywhere
  2. An attacker hitting `GET /auth/accept-invitation?token=<guess>` → `getInvitationByToken` (`apps/core/app/lib/invitations/service.server.ts`) hashes the guessed token and does an exact-match `prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } })` — with 256 bits of keyspace, brute-forcing a valid token is computationally infeasible; no rate limit or lockout was found on this loader specifically, but the token space itself is the primary defense, not a rate limit
- **Flow (reuse/replay):**
  1. Once accepted, `acceptInvitation` sets `status: "ACCEPTED"` in the same transaction that promotes the user — a second `GET`/`POST` with the same raw token hits `getInvitationByToken`'s `if (invitation.status !== "PENDING")` check and returns `410 INVITATION_USED` (mapped from `status: "ACCEPTED"`) before any further processing
  2. If the invitation was instead re-sent (`resendInvitation`) or a fresh invite issued to the same email (`createInvitation`'s `updateMany({ where: { email, status: "PENDING" }, data: { status: "REVOKED" } })`), the *original* token's hash no longer matches any `PENDING` row — `getInvitationByToken` returns `410 INVITATION_REVOKED` for it, so an old, superseded link cannot be replayed even though the email address is still "live"
  3. If the invitation expired (`expiresAt` in the past) before being accepted, `getInvitationByToken` returns `410 INVITATION_EXPIRED` regardless of token validity
- **Expected outcome:** A guessed token essentially never resolves (256-bit search space); a reused/superseded/expired token is rejected with a specific `410` reason and never re-activates or promotes the account it was issued for.
- **Failure modes / what could go wrong:** (1) No explicit rate limiting or lockout was found on the `accept-invitation` loader or `getInvitationByToken` itself — the defense against guessing is purely the token's entropy, not a request-throttling layer; this is a gap worth flagging even though 256 bits makes practical brute force infeasible. (2) The race-guard in `acceptInvitation` (checking for a `User` created for the same email between invite and accept) closes one specific TOCTOU window but was not traced for concurrent *accept* requests racing each other on the exact same still-`PENDING` token — the `$transaction` wrapping the promote step would need to be relied upon for that, which was not independently verified here beyond reading the code once.
- **Related code:**
  - `apps/core/app/lib/invitations/token.server.ts`
  - `apps/core/app/lib/invitations/service.server.ts`
  - `apps/core/app/routes/auth/accept-invitation.tsx`

---

### UC-UNITADMIN-010: Unit admin views the unit-wide chat aggregate — message bodies must never leak

- **Category:** Security
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ["CPSC"]`, `unitAdmins.canViewUnitChats` policy flag on
- **Preconditions:** Students, TAs, and instructors across multiple `CPSC` courses have active chat histories containing real conversation content
- **Entry point(s):** `apps/core/app/routes/units.$department.chats.tsx`, `apps/core/app/routes/api/units.chats.$.ts`
- **Flow:**
  1. Unit admin opens `/units/CPSC/chats`; the page loader confirms the session role is `ADMIN`/`UNIT_ADMIN` and, for `UNIT_ADMIN`, that `"CPSC"` is in their DB-read `authorizedUnits` — otherwise redirects to `/courses?access=denied`
  2. `useUnitChats` calls `GET /api/units/CPSC/chats` → the loader re-checks the same unit membership server-side (`getAuthorizedUnits`) and additionally gates on `getPolicy("unitAdmins.canViewUnitChats")` (off by default; `ADMIN` bypasses this flag entirely)
  3. `prisma.chat.findMany` is scoped by `course: { department: "CPSC", deletedAt: null }` and its `select` clause deliberately omits any messages/content field — only `id, title, createdAt, updatedAt, user.{id,name}, course.{id,code,name}` are read from the DB in the first place, so message bodies are never even fetched, let alone serialized
  4. A second, in-memory filter narrows the result to chats owned by an *active STUDENT enrollment* on that same course (`studentEnrollments` set), explicitly to stop a staff member's (instructor/TA/unit-admin's) own chat activity on a department course from leaking into what the code's own comment calls the "student chats" contract
  5. The response is remapped field-by-field into a plain object (`id, title, ownerId, ownerName, courseId, courseCode, courseName, createdAt, ...`), so even if the Prisma `select` were ever loosened, the response-shaping step is a second place a stray field would have to pass through
- **Expected outcome:** `200` with chat metadata only — titles, owners, timestamps, course identifiers — never message text or RAG-retrieved content. Chats in departments outside the unit admin's `authorizedUnits`, or staff-owned chats within the unit, never appear in the payload.
- **Failure modes / what could go wrong:** None found for data minimization on this specific endpoint — the omission of message content is structural (absent from the Prisma `select`) rather than a post-hoc redaction, and the department/policy-flag/student-ownership checks are all independently re-verified server-side rather than trusted from the page loader. A gap noted for completeness rather than found here: `GET /api/units/:department/chats` returning `403` vs. redirecting client-side means a direct API call from a disallowed unit admin surfaces a bare `Forbidden` JSON body rather than the friendlier page-level redirect — not a security issue, just an inconsistent UX between the page and API entry points.
- **Related code:**
  - `apps/core/app/routes/units.$department.chats.tsx`
  - `apps/core/app/routes/api/units.chats.$.ts`
  - `apps/core/app/lib/auth/course-access.server.ts`
