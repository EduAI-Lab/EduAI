# Canvas Integration — Technical Research

**Status:** Complete (June 2026)  
**Strategy report (read first):** [lti-canvas-integration-report.md](./lti-canvas-integration-report.md)  
**LTI (deferred):** [lti-schema-changes.md](./lti-schema-changes.md)  
**Integration how-to (Docker + web):** [canvas-api-integration-guide.md](./canvas-api-integration-guide.md)  
**Question Maker export:** [CANVAS_EXPORT.md](../../apps/extensions/question-maker/docs/features/CANVAS_EXPORT.md)

---

## 1. Summary

EduAI’s Canvas work splits into three unrelated mechanisms:

| Mechanism | Layer |
|-----------|--------|
| **CWL** | User logs into EduAI website |
| **Canvas REST API** | EduAI server calls Canvas (token on behalf of instructor) |
| **LTI 1.3** | User launches EduAI from inside Canvas |

**MVP recommendation:** CWL (or verified email) + **REST roster sync** + existing QM quiz REST. **Defer LTI** until in-Canvas launch is a requirement.

**Validated locally:** Roster endpoint + per-user profile fallback reliably yields `primary_email` for student matching, even when course users omits `email`.

---

## 2. CWL vs Canvas API vs LTI

### 2.1 CWL

- User visits EduAI → “Sign in with CWL” → UBC IdP → session on EduAI.
- Independent of Canvas login (user may use CWL on Canvas separately).
- **Roster sync answers:** “Which courses is this CWL user in?” by matching IdP email to synced Canvas emails.

### 2.2 Canvas personal access token

- Instructor: Canvas **Settings → Approved Integrations → New Access Token**.
- EduAI stores `canvasUrl` + encrypted token; server sends `Authorization: Bearer {token}`.
- **Not** the LTI developer key `client_id`.
- Question Maker already uses this pattern (`canvasService.js`).

### 2.3 LTI 1.3

- Admin registers tool (developer key), placements (e.g. course navigation).
- User click in Canvas → OIDC → signed JWT → EduAI provisions user/course/role.
- Does not export quizzes or download course files without additional REST/OAuth.

### 2.4 Compatibility matrix

| Question | Answer |
|----------|--------|
| Can API token replace LTI for in-Canvas launch? | **No** |
| Can LTI replace API for quiz export? | **No** |
| Can API + CWL replace LTI for MVP enrollments? | **Yes** (roster sync + email match) |
| Same credential for LTI and personal token? | **No** |

| Data need | Protocol |
|-----------|----------|
| Login to EduAI site | CWL / credential |
| Roster per course | REST (+ profile fallback) |
| Quiz export/import | REST |
| Course files for RAG | REST |
| Launch from Canvas menu | LTI |

---

## 3. LTI (reference — deferred)

### 3.1 Flow

1. OIDC initiation → platform auth → `POST /lti/callback` with ID token JWT.
2. Validate JWT (platform JWKS), read `sub`, `email`, `context`, LIS roles.
3. Upsert User, Course, Enrollment; create better-auth session.

### 3.2 Canvas admin setup

- Developer key JSON: `oidc_initiation_url`, `target_link_uri`, `public_jwk`, scopes, placements.
- Production JWKS: `https://sso.canvaslms.com/api/lti/security/jwks`
- UBC host example: `https://canvas.ubc.ca` — `issuer` must match registration.

### 3.3 Pros / cons

| Pros | Cons |
|------|------|
| Institutional install | High build + admin overhead |
| No separate signup when launching from Canvas | Does not do quiz/file APIs |
| NRPS, AGS | iframe/session complexity |
| LMS-agnostic launch | Not needed if users use EduAI URL |

Implementation design: [`lti-schema-changes.md`](./lti-schema-changes.md).

---

## 4. Canvas REST — endpoints EduAI uses

Base URL: `{canvasUrl}/api/v1` (no trailing slash on `canvasUrl`).

### 4.1 Question Maker (implemented)

| Action | Method | Path |
|--------|--------|------|
| List teacher courses | GET | `/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment` |
| Create quiz | POST | `/courses/:course_id/quizzes` |
| Add questions | POST | `/courses/:course_id/quizzes/:quiz_id/questions` |
| List/import quizzes | GET | `/courses/:course_id/quizzes`, questions endpoints |

### 4.2 Core roster sync (proposed)

| Step | Method | Path |
|------|--------|------|
| Teacher courses | GET | `/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment` |
| Students in course | GET | `/courses/:course_id/users?enrollment_type[]=student&include[]=email&per_page=100` |
| Email fallback | GET | `/users/:canvas_user_id/profile` |

**Avoid:** `GET /courses/:id/students` (deprecated).

**Avoid:** `GET /courses/:id/enrollments` alone for email — nested `user` often has no `email`.

**Invalid:** `include[]=primary_email` on course users (not a supported include; use profile).

### 4.3 Fields to store per roster row

| Field | Source |
|-------|--------|
| `canvasUserId` | `id` |
| `email` | roster `email` ?? `profile.primary_email` ?? `profile.login_id` |
| `sisUserId` | `sis_user_id` (nullable) |
| `courseCanvasId` | course id from sync |

Normalize email: lowercase, trim before match.

### 4.4 Match on EduAI signup

1. `User.email` (from CWL or verified registration) ↔ stored roster email  
2. Optional: user-supplied student number ↔ `sis_user_id`  
3. Require **verified email** for pilots without CWL to reduce impersonation risk  

---

## 5. Local Canvas LMS testing (June 2026)

Environment: Canvas on `http://localhost:3000` (not port 80). Hand-created users — patterns below are **API behavior**, not UBC production data.

### 5.1 PowerShell

`curl` in PowerShell aliases `Invoke-WebRequest`. Use **`curl.exe`** or **`Invoke-RestMethod`**.

```powershell
$token = "YOUR_TOKEN"
$base = "http://localhost:3000"
$h = @{ Authorization = "Bearer $token" }

# Teacher courses
Invoke-RestMethod "$base/api/v1/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment&per_page=10" -Headers $h

# Students in course 2
Invoke-RestMethod "$base/api/v1/courses/2/users?enrollment_type[]=student&include[]=email&per_page=100" -Headers $h

# Profile fallback for canvas user id 3
Invoke-RestMethod "$base/api/v1/users/3/profile" -Headers $h
```

Verbose debugging: `curl.exe -v -H "Authorization: Bearer $token" "$base/api/v1/courses/2/users?..."`

### 5.2 Observed results

| Call | Result |
|------|--------|
| `/courses/2/users` (no student filter) | Prof + students; prof had `email`, student often did not |
| `/courses/2/users?enrollment_type[]=student&include[]=email` | Students only; **still no `email`** on some rows |
| `/courses/2/students` (deprecated) | Student had `login_id` but not always on `/users` |
| `/users/3/profile` | `primary_email`, `login_id` for test students |
| `/users/5/profile` | `primary_email`: `aoludare@student.ubc.ca`, **`login_id`: null** |

**Conclusion:** Implement **profile fallback**; prefer **`primary_email`** over `login_id`; do not assume roster returns email.

### 5.3 Connection errors

`Connection refused` on `http://localhost` (port 80) means Canvas is on another port (e.g. **3000**) or not running. Use the same host:port as the browser.

### 5.4 Security

Never commit API tokens. Revoke tokens if pasted in chat, terminals, or screenshots.

---

## 6. UBC production validation (required before launch)

Local fake users (`student2@example.com`, `sis_user_id: student_2`) do not predict UBC. On **one pilot course** on `canvas.ubc.ca`:

1. Instructor token (or LT-approved developer key).
2. Run teacher courses + student users + one profile call.
3. Record **which fields are present** (redacted); not real addresses in git.

Ask LT Hub: personal tokens allowed? PIA for roster storage? CWL email vs Canvas `primary_email` alignment.

---

## 7. Personal token vs institutional key vs LTI

| Approach | MVP | Production scale |
|----------|-----|------------------|
| Personal access token | Yes — QM already; roster sync pilots | Policy may disallow |
| Scoped developer key | Later | Preferred at institutions |
| LTI | No for Path A | If course navigation required |

---

## 8. Pros and cons (condensed)

### REST + CWL roster (MVP path)

| Pros | Cons |
|------|------|
| Fits “users on our site” | Per-instructor token setup |
| Faster than LTI | Manual re-sync when roster changes |
| Profile fallback proven locally | UBC field mix unknown until pilot |
| Reuses QM patterns | PIA still required |

### LTI (deferred)

| Pros | Cons |
|------|------|
| In-Canvas UX | Large build |
| Auto role on launch | Admin + PIA |
| NRPS | Not needed if CWL + REST roster |

---

## 9. Implementation checklist (Core)

- [ ] `CanvasIntegration` or equivalent on Core (url, encrypted token, `userId`)
- [ ] `POST /api/canvas/connect`, `POST /api/canvas/sync-rosters` (names TBD)
- [ ] Roster staging table or equivalent before `User` exists
- [ ] Sync: courses → users → profile fallback → upsert `Course` + roster rows
- [ ] On login: match email → `Enrollment` (`externalSource: canvas`)
- [ ] Paginate Canvas list endpoints (`Link` header / `page` param)
- [ ] Rate-limit sync (instructor-triggered, not per-page view)

---

## 10. Decision matrix

| Scenario | Use |
|----------|-----|
| Student uses eduai.ubc.ca + CWL | **CWL** + roster match |
| Instructor syncs class from Canvas | **REST** roster + profile |
| Export quiz to Canvas | **REST** (QM today) |
| Student clicks EduAI in Canvas menu | **LTI** (later) |
| Pull files for RAG | **REST** (Epic #59) |
| Local dev without Canvas | QM **test mode** |

---

## 11. References

| Resource | URL |
|----------|-----|
| Canvas — List users in course | https://developerdocs.instructure.com/services/canvas/resources/courses |
| Canvas — User profile | https://developerdocs.instructure.com/services/canvas/resources/users |
| Canvas — Enrollments | https://developerdocs.instructure.com/services/canvas/resources/enrollments |
| Canvas REST API | https://canvas.instructure.com/doc/api/ |
| Canvas OAuth2 | https://canvas.instructure.com/doc/api/file.oauth.html |
| Canvas LTI config | https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.lti_dev_key_config |
| UBC LT Hub privacy | https://lthub.ubc.ca/support/privacy/ |
| Edlink API vs LTI | https://ed.link/community/api-vs-lti-integration-for-canvas/ |

---

## Document history

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-05-31 | Initial LTI vs API research |
| 2.0 | 2026-05-31 | Link to strategy report v2 |
| 3.0 | 2026-06-03 | Full rewrite: CWL-first, roster API details, local test log, profile fallback, PowerShell notes, implementation checklist |
