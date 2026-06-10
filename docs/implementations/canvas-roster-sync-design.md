# Canvas Roster Sync — Detailed Design (Draft)


|                     |                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------- |
| **Status**          | **Draft — for team review**                                                            |
| **Date**            | June 2026                                                                              |
| **Audience**        | Engineering, product                                                                   |
| **Epic**            | EduAICore #59 (platform centralization)                                                |
| **Depends on**      | Core Canvas connect API (#381), settings UI (#472)                                     |
| **Constraint**      | **CWL not available yet** — do not auto-match on `User.email`; use student-number linker in MVP |
| **MVP deliverable** | Instructor **Sync enrollments** + student **student-number link** → staged roster + `Enrollment` rows |


**Related docs:**


| Document                                                          | Role                                        |
| ----------------------------------------------------------------- | ------------------------------------------- |
| [Canvas integration strategy](./lti-canvas-integration-report.md) | Product direction (CWL-first, LTI deferred) |
| [Canvas LTI vs API research](./canvas-lti-vs-api-key-research.md) | Endpoint reference, local API test results  |
| [Canvas API integration guide](./canvas-api-integration-guide.md) | Token setup, connect API                    |



---

## 1. Purpose

This document specifies **how Core syncs Canvas courses and rosters** when an instructor clicks **Sync enrollments**, and how students link via **student number (MVP)** or **CWL (post-MVP)**.

It answers:

1. What happens when an instructor clicks **Sync enrollments** (**MVP**).
2. What data we store in staging before a student has an EduAI account (**MVP**).
3. How students get `Enrollment` rows (**MVP:** student-number link; **post-MVP:** CWL).
4. What we deliberately **do not** do (ghost users, synchronous bulk profile fetch, unverified email matching).

This is a **design draft** for teammate feedback. Implementation issue numbers (e.g. #398) may be assigned after review.

---

## 2. Executive summary

### 2.1 Two halves (full product — not all in MVP)


| Half            | Source                              | Question it answers            | MVP?              |
| --------------- | ----------------------------------- | ------------------------------ | ----------------- |
| **Roster sync** | Canvas REST (instructor token)      | Who should be in which course? | **Yes**           |
| **Login link**  | Student number (MVP) or CWL (future) | Who is this person on EduAI?   | **Partial** (student-number linker in MVP) |


For **MVP**, sync completes the first half (courses + staged roster). Students gain `Enrollment` rows via the **student-number linker** (§6.3) until CWL ships. CWL-based email/SIS matching remains post-MVP (§6.1–6.2).

### 2.2 Performance principle

Sync must stay **fast** for large classes (e.g. 3 courses × 200 students):

- **~7–15 Canvas API calls** for that size (paginated roster lists).
- **No per-student `/profile` calls on the sync hot path.**
- Optional email enrichment runs **async**, only for rows missing email — **not required for MVP**.

### 2.3 Identity matching — full product (after CWL)

When CWL is live, matching priority becomes:

1. **Email** — CWL-verified `User.email` ↔ staged roster email.
2. **SIS ID from IdP** — CWL student number ↔ Canvas `sis_user_id`.
3. **Manual fallback** — user enters student number ↔ `sis_user_id`.

### 2.3.1 Without CWL — what actually works?

CWL is not available in MVP. Of the matching strategies in §2.3 and §6, **only manual student-number linking (§6.3) is viable** for connecting a logged-in `User` to staged roster rows:

| Strategy                         | Works without CWL? | Notes                                                                 |
| -------------------------------- | ------------------ | --------------------------------------------------------------------- |
| Email ↔ staging email            | **No**             | Requires CWL-verified institutional email (§6.1)                      |
| CWL student number ↔ `sis_user_id` | **No**           | Requires CWL attribute on `User` (§6.2)                               |
| Manual student number ↔ `sis_user_id` | **Yes**       | One input field + `POST /api/canvas/link-roster` — **MVP linker**     |
| Canvas account search by email   | **No**             | Deferred; not validated for instructor PAT on UBC (§6.5)              |

We are not aware of another trustworthy linker without CWL. MVP assumes CWL stays unavailable and ships the student-number flow alongside sync.

**Pre-MVP blocker:** Confirm on a real `canvas.ubc.ca` course that Canvas `sis_user_id` equals the student number students know and type (§9 #2). If it does not, the linker design must change before MVP ships.

### 2.4 MVP scope (no CWL)

**Ship now:**


| Item                        | Details                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| **Sync enrollments button** | `POST /api/canvas/sync-rosters` + UI on Canvas settings (#472)              |
| **Course upsert**           | Canvas teacher courses → Core `Course` (`externalId`, `externalSource`)     |
| **Roster staging**          | `CanvasRosterMember` rows per student/TA (see §4.2)                         |
| **Instructor enrollment**   | Syncing professor gets `Enrollment` role `INSTRUCTOR` on each synced course |
| **Re-sync**                 | Deactivate staging rows dropped from Canvas roster                          |
| **Sync status in UI**       | Counts, `lastSyncedAt`, error messages                                      |
| **Student-number linker**   | `POST /api/canvas/link-roster` + UI: enter UBC student number (§6.3)        |
| **Linker security**         | Rate-limit + audit log on link attempts (§12)                               |


**Do not ship in MVP:**


| Item                                        | Why                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **`User.email` ↔ roster email matching**    | Without CWL, roster email is institutional but `User.email` is often personal (e.g. Gmail) — auto-match would **silently miss** most students. Not primarily impersonation (`User.emailVerified` exists); the issue is **reliability**. |
| **Automatic student `Enrollment` on login** | No trustworthy identity signal until CWL or explicit student-number entry                       |
| **CWL login hook `resolveCanvasEnrollments`** | Email/SIS auto-match deferred until CWL (§6.1–6.2)                                            |
| **Async bulk `/profile` enrichment**        | Optional; staging works with `canvasUserId` + `sis_user_id` without email                       |


**MVP outcome for instructors:** After sync, Core has the right **courses** and a **roster snapshot** professors (and admin tools) can trust.

**MVP outcome for students:** After sync, they enter their **student number** once to link staged roster rows → `Enrollment` rows (§6.3). No CWL required.

**Email on staging:** Still **store** roster `email` when Canvas returns it (for future CWL matching). Do **not** use it to create student `Enrollment` in MVP.

---

## 3. Product flows

### 3.1 Instructor — Sync enrollments (**MVP**)

```text
1. Sign in to EduAI (existing auth — email/password for dev/pilot users)
2. Settings → Canvas → Connect (canvasUrl + personal access token)   [#381]
3. Click "Sync enrollments"
4. Core pulls teacher courses + rosters from Canvas (~seconds)
5. UI shows: courses synced, roster member count, lastSyncedAt
6. Instructor has INSTRUCTOR Enrollment on each synced course
```

### 3.2 Student / TA enrollment link (**MVP — student number**)

```text
1. Professor has already synced (roster staged in Core)
2. Student/TA signs in (existing auth)
3. Settings (or onboarding): enter UBC student number → POST /api/canvas/link-roster
4. Backend matches normalize(input) ↔ staging.sisUserId → upsert Enrollment rows
5. Student sees courses on dashboard / in extensions
```

Post-MVP: same flow extended with CWL email/SIS auto-match on login (§6.1–6.2), reducing manual entry.

### 3.3 Re-sync

Instructor clicks **Sync** again (manual; no cron in v1):

- New roster members added to staging.
- Removed members marked inactive in staging (and linked enrollments deactivated).
- Existing EduAI users re-linked if new email/sis data appears.

---

## 4. Data model

### 4.1 Existing tables (no change to shape)


| Model               | Role in sync                                              |
| ------------------- | --------------------------------------------------------- |
| `CanvasIntegration` | Encrypted token + `canvasUrl` per instructor (#381)       |
| `Course`            | `externalId` + `externalSource: "canvas"`, `lastSyncedAt` |
| `Enrollment`        | Live link `userId` ↔ `courseId`; created at link time     |
| `User`              | Created at login only — **not** bulk-created at sync      |


### 4.2 New table (proposed): `CanvasRosterMember`

Staging between Canvas sync and EduAI login. Holds **expected** course membership from Canvas.

#### Why not use `Enrollment` for staging?

`Enrollment.userId` is **NOT NULL** with a required FK to `User`. You cannot stage a roster member who has not signed up yet. Making `userId` nullable would break the `(courseId, userId)` unique constraint for real enrollments and force every access-control query to filter out pending rows. A dedicated staging table keeps **expected** Canvas membership separate from **live** EduAI enrollments until a student links (§6.3) or CWL resolves identity (§6).

```prisma
// PROPOSED — not in schema yet; names/fields open for review

model CanvasRosterMember {
  id             String         @id @default(cuid())
  courseId       String         // Core Course.id
  canvasUserId   String         // Canvas user id (stringified)
  sisUserId      String?        // Canvas sis_user_id (often student number at UBC)
  email          String?        // normalized lowercase; nullable if Canvas omits
  displayName    String?
  role           EnrollmentRole // STUDENT | TA (INSTRUCTOR synced via separate path)
  syncedByUserId String         // instructor User.id who ran sync
  isActive       Boolean        @default(true)
  lastSeenAt     DateTime       // updated each sync when row still on roster
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  course         Course         @relation(fields: [courseId], references: [id], onDelete: Cascade)
  syncedBy       User           @relation(fields: [syncedByUserId], references: [id])

  @@unique([courseId, canvasUserId, role])
  @@index([email])
  @@index([sisUserId])
  @@index([canvasUserId])
  @@map("canvas_roster_members")
}
```

**Design notes:**

- One row per `(course, canvas user, role)`.
- `email` stored normalized: `trim().toLowerCase()`.
- `sisUserId` compared as normalized string (exact rules TBD after UBC pilot).
- `isActive: false` when user drops off roster; row retained for audit.

### 4.3 Course upsert mapping (Canvas → Core)


| Core field       | Canvas source           | Notes                                         |
| ---------------- | ----------------------- | --------------------------------------------- |
| `externalId`     | course `id`             | String                                        |
| `externalSource` | `"canvas"`              | Fixed                                         |
| `name`           | `name`                  |                                               |
| `code`           | `course_code`           | Fallback: parse from `name`                   |
| `section`        | TBD                     | Parse from `sis_course_id` or default `"001"` |
| `term` / `year`  | TBD                     | Parse from `sis_course_id` or enrollment term |
| `startDate`      | `start_at` or sync date | Required by schema                            |
| `endDate`        | `end_at`                | Optional                                      |
| `lastSyncedAt`   | `now()`                 |                                               |


**Open:** UBC `sis_course_id` format — see §10.

### 4.4 Enrollment creation (link time)


| Core field       | Source                                                |
| ---------------- | ----------------------------------------------------- |
| `courseId`       | from matched `CanvasRosterMember`                     |
| `userId`         | logged-in `User.id`                                   |
| `role`           | from staging row                                      |
| `externalSource` | `"canvas"`                                            |
| `externalId`     | Canvas enrollment id if captured; else `canvasUserId` |
| `isActive`       | mirrors staging + roster state                        |


---

## 5. Sync algorithm (instructor-triggered)

**Trigger:** `POST /api/canvas/sync-rosters`  
**Auth:** Session; caller must be `INSTRUCTOR` or `ADMIN` with `CanvasIntegration`  
**Target duration:** ~5–15 seconds for 600 roster rows across 3 courses (network dependent)

### Step 1 — Load credentials

```text
integration = getCanvasIntegrationWithDecryptedKey(session.userId)
if !integration → 400 "Connect Canvas first"
canvasUrl, apiKey = integration
```

### Step 2 — List instructor Canvas courses

```http
GET {canvasUrl}/api/v1/courses
  ?enrollment_type=teacher
  &enrollment_role=TeacherEnrollment
  &per_page=100
```

- Follow Canvas pagination (`Link` header or `page` query).
- Skip concluded courses if desired (filter `workflow_state` — **open question**).

### Step 3 — Upsert Core `Course` per Canvas course

For each Canvas course:

```text
course = upsert Course where externalSource="canvas" AND externalId=canvasCourse.id
map fields (§4.3)
course.lastSyncedAt = now()
```

**Shared course rule (proposed):** If another instructor already synced the same Canvas course id, reuse the same Core `Course` row (unique on `externalSource` + `externalId`). Both instructors get `Enrollment` role `INSTRUCTOR`.

### Step 4 — Ensure instructor enrollment

```text
upsert Enrollment(userId=syncingInstructor, courseId, role=INSTRUCTOR, isActive=true)
```

### Step 5 — Fetch roster per course (fast path)

**Students:**

```http
GET {canvasUrl}/api/v1/courses/{canvasCourseId}/users
  ?enrollment_type[]=student
  &include[]=email
  &per_page=100
```

**TAs (if in scope for v1):**

```http
GET ...?enrollment_type[]=ta&include[]=email&per_page=100
```

Paginate until empty page.

For each user row:

```text
staging = upsert CanvasRosterMember(
  courseId       = coreCourse.id,
  canvasUserId   = row.id,
  sisUserId      = row.sis_user_id ?? null,
  email          = normalize(row.email) ?? null,   // do NOT call /profile here
  displayName    = row.name,
  role           = STUDENT | TA,
  syncedByUserId = session.userId,
  isActive       = true,
  lastSeenAt     = now(),
)
```

### Step 6 — Deactivate dropped members

```text
for each course synced in this run:
  update CanvasRosterMember
    set isActive = false
    where courseId = course.id
      and lastSeenAt < syncRunStartedAt
```

For rows already linked to a `User`:

```text
update Enrollment set isActive = false
  where userId linked via prior match
    and courseId = course.id
    and no active staging row for that canvasUserId
```

### Step 7 — Instructor enrollment only (**MVP**)

```text
upsert Enrollment(
  userId = syncingInstructor,
  courseId = each synced course,
  role = INSTRUCTOR,
  isActive = true,
)
```

**Not in MVP:** eager link of students by `User.email` (§6.4). Staging rows are written at sync; student `Enrollment` is created via student-number link (§6.3) or post-CWL auto-match.

### Step 8 — Response

```json
{
  "coursesSynced": 3,
  "membersSynced": 587,
  "lastSyncedAt": "2026-06-04T12:00:00.000Z"
}
```

(`membersLinked` omitted in MVP — no automatic student linking.)

### Step 9 — Optional async enrichment (**post-MVP**)

If staging rows exist with `email IS NULL`:

- Queue background job with bounded concurrency (e.g. 10–15 parallel).
- For each: `GET /users/{canvasUserId}/profile` → store `primary_email`.
- Retry on HTTP 429 with backoff.
- Update `CanvasRosterMember.email` for future CWL matching.

Defer until CWL linker is planned. Not required for sync-button MVP.

---

## 6. Enrollment linking

**MVP:** §6.3 student-number link (manual UI + API).  
**Post-MVP:** §6.1–6.2 CWL login hook; §6.4 optional eager link after CWL.

Function (proposed name for CWL path): `resolveCanvasEnrollments(user: User)`

### 6.1 Email match (**requires CWL**)

Only when `User.email` comes from CWL (institutionally verified):

```text
rows = CanvasRosterMember where isActive=true
       and email = normalize(user.email)

for each row:
  upsert Enrollment(user, row.courseId, row.role)
```

**Do not use** self-registered or unverified `User.email` for this match.

### 6.2 SIS ID match (CWL attribute)

```text
sisFromIdP = user.studentNumberFromCwl  // attribute name TBD
if sisFromIdP:
  rows = staging where isActive and sisUserId matches normalize(sisFromIdP)
  upsert Enrollments
```

### 6.3 Student-number link (**MVP**)

Without CWL this is the **only** viable linker (§2.3.1). Scope is small: one endpoint + one input field; staging already captures `sisUserId` at sync.

```text
POST /api/canvas/link-roster
  body: { studentNumber: "12345678" }

normalize(input) === staging.sisUserId
→ upsert Enrollment(s) for all active staging rows for this user
```

Copy: “Enter your UBC student number to link Canvas enrollments.”

**MVP requirements:** rate-limit (prevent enumeration) and audit log (§12). Ship alongside sync UI.

### 6.4 Eager link on sync (optional, post-CWL)

After staging upsert, for users with **CWL-verified email** or known `sisUserId` on `User`:

```text
user = find User by verified email OR sis field
if user:
  upsert Enrollment(user, course, role from staging)
```

### 6.5 Optional Canvas account search

Deferred; validate with instructor PAT on `canvas.ubc.ca` before use.

### Match priority summary (full product)


| Priority | Match                                 | Requires    | MVP?             |
| -------- | ------------------------------------- | ----------- | ---------------- |
| 1        | CWL email ↔ staging email             | CWL         | No               |
| 2        | CWL student number ↔ `sis_user_id`    | CWL         | No               |
| 3        | Manual student number ↔ `sis_user_id` | Link UI     | **Yes (MVP)**    |
| 4        | Account search by email               | API + token | No               |


---

## 7. Canvas API reference (sync)

Base: `{canvasUrl}/api/v1`  
Auth: `Authorization: Bearer {decryptedToken}`


| Step                                | Method | Path                                                                 |
| ----------------------------------- | ------ | -------------------------------------------------------------------- |
| Verify connect (existing)           | GET    | `/users/self/profile`                                                |
| Teacher courses                     | GET    | `/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment` |
| Students in course                  | GET    | `/courses/:id/users?enrollment_type[]=student&include[]=email`       |
| TAs in course                       | GET    | `/courses/:id/users?enrollment_type[]=ta&include[]=email`            |
| Profile fallback (async/login only) | GET    | `/users/:canvasUserId/profile`                                       |
| Account search (login fallback)     | GET    | `/accounts/self/users?search_term=...`                               |


**Avoid:**

- `GET /courses/:id/students` (deprecated)
- `include[]=primary_email` on course users (invalid)
- Synchronous `/profile` for every roster row during sync

**Pagination:** Use `per_page=100`; follow `Link: ... rel="next"` until exhausted.

**Rate limits:** Canvas may return 429. Sync should use retry with backoff; async enrichment must cap concurrency.

---

## 8. API surface (Core)

### 8.1 Implemented (#381)


| Method | Path                      | Purpose            |
| ------ | ------------------------- | ------------------ |
| GET    | `/api/canvas/integration` | Connection status  |
| POST   | `/api/canvas/connect`     | Save URL + token   |
| DELETE | `/api/canvas/disconnect`  | Remove integration |


### 8.2 MVP (sync + student link)


| Method | Path                       | Purpose                                       |
| ------ | -------------------------- | --------------------------------------------- |
| POST   | `/api/canvas/sync-rosters` | Run §5 sync algorithm                         |
| POST   | `/api/canvas/link-roster`  | Student-number link (§6.3)                    |
| GET    | `/api/canvas/integration`  | Extend with `lastSyncedAt`, counts (optional) |


UI (#472): **Sync enrollments** button + status on Canvas settings tab; student-number input for link flow.

### 8.3 Post-MVP


| Method | Path                      | Purpose                                     |
| ------ | ------------------------- | ------------------------------------------- |
| GET    | `/api/canvas/sync-status` | Optional if not merged into GET integration |


### 8.4 Internal (post-MVP)


| Function                         | Purpose                            |
| -------------------------------- | ---------------------------------- |
| `resolveCanvasEnrollments(user)` | Post-CWL login hook (§6)           |
| `enrichRosterEmails(job)`        | Async profile fallback (§5 Step 9) |


---

## 9. UBC pilot checklist (required before launch)

Run on **one real course** on `canvas.ubc.ca` with an instructor PAT. **Redact PII** in notes; do not commit real emails to git.

### Blocker (must pass before MVP ship)

| #   | Check                                                                                                      | Record | Status |
| --- | ---------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **B1** | **`sis_user_id` === student number students know/type?** On one real course, compare Canvas `sis_user_id` to the number students enter for registration/services. If not equal, student-number linker MVP shape is invalid. |        | **Open** |

The whole student-number linker depends on this. Treat as a **go/no-go gate**, not a nice-to-have checklist item.

### Other checks


| #   | Check                                                                           | Record           |
| --- | ------------------------------------------------------------------------------- | ---------------- |
| 1   | Roster `include[]=email` — what % of students have `email` on the list row?     |                  |
| 2   | Is `sis_user_id` populated on most roster rows? (see **B1** for format match)   |                  |
| 3   | For one student without list email: does `/profile` return `primary_email`?     |                  |
| 4   | Does CWL email equal Canvas `primary_email` / roster email?                     | (when CWL ships) |
| 5   | Does `GET /accounts/self/users?search_term={email}` work with instructor token? |                  |
| 6   | LT Hub: personal tokens allowed for roster sync? PIA for storing roster data?   |                  |


Results should drive post-MVP linker design (async profile, manual student number, CWL attributes).

---

## 10. Open questions for team review

Please comment on these in PR/issue review. **MVP-focused items first.**


| #      | Question                                                             | Proposal                                                      | Alternatives                                     |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| **M1** | **MVP = sync + student-number linker?**                              | **Yes** — sync button + `link-roster` (team review consensus)   | Sync only; wait for CWL                          |
| **M2** | **Button label**                                                     | "Sync enrollments"                                            | "Sync courses", "Sync rosters"                   |
| **M3** | **Expose staging to UI?**                                            | Instructor sees member count only                             | Admin roster table view                          |
| 1      | **Shared Core course** when two instructors sync same Canvas course? | One `Course` per `externalId`; both get INSTRUCTOR enrollment | Duplicate courses per instructor                 |
| 2      | **TAs in MVP sync?**                                                 | Yes — extra roster API call per course                        | Students only in MVP                             |
| 3      | **Course metadata parsing**                                          | Minimal MVP: name + code from Canvas; default section/term    | Full `sis_course_id` parser for UBC              |
| 4      | **Concluded courses**                                                | Skip `workflow_state=completed` unless instructor opts in     | Sync all teacher enrollments                     |
| 5      | **Interim without CWL**                                              | Separate issue: student-number link UI                        | Wait for CWL only                                |
| 6      | **Staging table name**                                               | `CanvasRosterMember`                                          | `PendingEnrollment`, `CanvasRosterStaging`, etc. |
| 7      | **Who can sync**                                                     | Only user with own `CanvasIntegration`                        | Admin sync on behalf of instructor               |
| 8      | **QM token sharing**                                                 | Core token only for MVP                                       | Migrate QM to read Core integration              |
| 9      | `**externalId` on Enrollment**                                       | Canvas enrollment id if available from API                    | Use `canvasUserId` only                          |


---

## 11. Edge cases


| Scenario                            | Behavior                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Student not on EduAI yet            | Staging row only; no `User`, no `Enrollment` (**MVP**)                              |
| Student logs in before prof syncs   | No enrollments until sync (**MVP**)                                                 |
| Student logs in after sync (no CWL) | No auto-enroll; student enters number via link UI (§6.3)                              |
| Email changes in Canvas             | Re-sync updates staging; CWL linker re-links later                                  |
| Duplicate email on two Canvas users | Log warning; use `sis_user_id` when linker ships                                    |
| `sis_user_id` null on roster        | Store row anyway; linker may use email after CWL                                    |
| TA is also a student in same course | Two staging rows (different roles) or Canvas single role — **confirm API behavior** |
| Instructor disconnects Canvas       | Staging rows remain; stop new syncs; do not delete courses                          |
| Test mode integration (#381)        | Sync returns mock data or skips Canvas calls — mirror connect test mode             |


---

## 12. Security and privacy

- Roster data (email, student number, names) is **personal information** under FIPPA.
- Expect PIA or amendment before production roster storage (see [strategy report §7](./lti-canvas-integration-report.md)).
- Store minimum fields needed for matching.
- Never return decrypted Canvas token to client.
- **MVP:** student-number link **must** rate-limit and audit (prevent enumeration) — not post-MVP polish.
- Normalize and compare `sis_user_id` as string; do not expose whether a given student number exists in a course without auth.

---

## 13. Implementation phases (suggested)


| Phase  | Scope                     | Deliverable                                                     | MVP?    |
| ------ | ------------------------- | --------------------------------------------------------------- | ------- |
| **P0** | UBC blocker check         | Verify **B1**: `sis_user_id` === student number (§9)          | **Gate** |
| **P1** | Schema + sync API         | `CanvasRosterMember`, `POST sync-rosters`, Canvas client, tests | **Yes** |
| **P2** | Sync + link UI            | Sync button + student-number link UI (#472), `POST link-roster` | **Yes** |
| **P3** | Linker hardening          | Rate-limit + audit on link-roster (§12)                         | **Yes** |
| **P4** | CWL + login linker        | `resolveCanvasEnrollments`, email/sis match (§6.1–6.2)          | No      |
| **P5** | Pilot + polish            | Remaining §9 checks, async email if needed, CHANGELOG           | No      |


**MVP = P0 (pass) + P1 + P2 + P3.** Instructor syncs rosters; students link via student number; enrollments created.

---

## 14. Out of scope (MVP)

- CWL integration and automatic student enrollment on login (email/SIS auto-match)
- Matching on `User.email` without CWL (unreliable — personal vs institutional email)
- LTI launch / NRPS
- Creating `User` records for every Canvas roster member at sync time
- Automatic scheduled sync (cron) — manual re-sync in MVP
- Quiz export/import (Question Maker — separate)
- Institutional Canvas developer key (until UBC approves)
- File/material sync from Canvas

---

## 15. Diagram

```mermaid
sequenceDiagram
  participant Prof as Instructor
  participant Core as EduAI Core
  participant Canvas as Canvas API
  participant Staging as CanvasRosterMember
  participant Enroll as Enrollment

  Prof->>Core: POST /canvas/connect (#381)
  Core->>Canvas: GET /users/self/profile
  Core-->>Prof: connected

  Prof->>Core: POST /canvas/sync-rosters (MVP)
  Core->>Canvas: GET /courses (teacher)
  loop each course
    Core->>Canvas: GET /courses/:id/users (paginated)
    Core->>Staging: upsert roster rows
  end
  Core->>Enroll: upsert INSTRUCTOR for prof
  Core-->>Prof: coursesSynced, membersSynced

  Note over Core,Staging: MVP: student-number link; post-MVP: CWL auto-match
```



---

## 16. Changelog (this document)


| Version | Date       | Notes                                                                  |
| ------- | ---------- | ---------------------------------------------------------------------- |
| 0.1     | 2026-06-04 | Initial draft for team review                                          |
| 0.2     | 2026-06-04 | MVP scoped to sync enrollments button; no CWL / no User.email matching |
| 0.3     | 2026-06-05 | PR #459 review: student-number linker in MVP; email-match rationale; staging “why”; B1 blocker |


