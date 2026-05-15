# Platform Centralization — Architecture Plan

> **This is a living document.** It is a work in progress and should be treated as a starting point, not a final answer. Any section can be revised, restructured, or replaced entirely as the team learns more and makes decisions together.

**Epic:** EduAICore #58  
**Last Updated:** May 10, 2026

---

## Table of Contents

- [0. TL;DR](#0-tldr)
- [1. Current State — What We Have](#1-current-state--what-we-have)
- [2. Target State — What We're Building Toward](#2-target-state--what-were-building-toward)
- [3. Gap Analysis — Work Required](#3-gap-analysis--work-required)
- [4. API Contracts](#4-api-contracts)
- [5. Migration Plan](#5-migration-plan)
- [6. Key Decisions for This Meeting](#6-key-decisions-for-this-meeting)
- [7. Week-by-Week Checklist](#7-week-by-week-checklist)
- [8. Tech Notes](#8-tech-notes)
- [9. Out of Scope for This Epic](#9-out-of-scope-for-this-epic)
- [10. File Reference](#10-file-reference)
- [11. Known Challenges](#11-known-challenges)
- [12. Monorepo](#12-monorepo)

---

## 0. TL;DR

Everything **shared** across AI Tutor, Question Maker, and Course-Aware Chat must go through **EduAI's API**. Anything specific to one extension stays in that extension.

Today the three extensions were built independently. Each has its own auth, its own copy of user/course data, and its own way of managing things. This causes duplication, inconsistency, and makes central management impossible (e.g., a student's enrollment change in EduAI should propagate everywhere — not require a manual re-sync in each extension).

---

## 1. Current State — What We Have

### 1.1 EduAI

The central platform. Already owns:

- **Auth:** Better Auth (email/password + API keys). Acts as an **OAuth 2.0 / OIDC provider** — extensions can authenticate users through EduAI.
- **Users & Roles:** Admin, Professor, TA, Student
- **Courses:** Full course management (create, enroll, TA assignment, topics)
- **Materials / RAG:** Document upload, chunking, vector embeddings, semantic search (PGVector)
- **Chat / AI:** Streaming chat with RAG, multi-model support (OpenAI, Google, Ollama)
- **AI Models:** Dynamic model registry with per-provider config
- **Usage Logging:** AI interaction logs

> **Note:** Course-Aware Chat lives **in** EduAI. The `/chat` route in this repo is the Course-Aware Chat experience. It does not live in a separate repo.

---

### 1.2 AI Tutor — Current Integration Status

| Domain | Status | Notes |
|--------|--------|-------|
| Auth | Centralized | Uses EduAI's OAuth/OIDC (Better Auth genericOAuth plugin) |
| AI Chat | Centralized | Proxies all AI calls through `POST /api/chat` on EduAI |
| AI Models | Centralized | Fetches model list from EduAI |
| Courses | Partial — one-time sync | Instructors manually "import" a course (copies metadata + enrollments + topics into AI Tutor's local DB). **Changes in EduAI don't auto-propagate.** |
| Users | Partial — local mirror | Has its own `User` table, but populated from EduAI OAuth claims. It's a projection of EduAI data, not a second source of truth. |
| Activities / Content | AI Tutor-specific | Modules, Lessons, Activities, Submissions, Analytics — stay in AI Tutor |
| Prompt Templates | AI Tutor-specific | Stays in AI Tutor |

---

### 1.3 Question Maker — Current Integration Status

| Domain | Status | Notes |
|--------|--------|-------|
| Auth | Not integrated | Fully standalone JWT auth with local user registration. **No integration with EduAI.** |
| Users | Local only | Local `users` table with bcrypt passwords. Completely separate from EduAI. |
| Courses | Partial — reference only | Local `courses` table. Instructors can call `GET /api/eduai/courses` to list EduAI courses for reference, but local courses are entirely separate. |
| Topics | Partial — reference only | Fetched from EduAI on-demand but stored locally for FK associations. |
| AI Chat / Question Generation | Partial | OCR extraction and variant generation proxy through Core. The main question generation route still dispatches directly to Groq, OpenAI, or DeepSeek — see QM-7. |
| Questions / Variants | QM-specific | Question bank, variant workflows, assessment building — stay in Question Maker |
| Assessments | QM-specific | Quiz/test building, section management — stays in Question Maker |
| Canvas Quiz Export/Import | QM-specific | Quiz delivery via Canvas — currently standalone, to be centralized (see Decision #4) |

---

## 2. Target State — What We're Building Toward

### 2.1 Ownership Map

| Domain | Owned By | Notes |
|--------|----------|-------|
| Authentication / Sessions | EduAI | Single sign-on for all extensions |
| User Accounts & Roles | EduAI | Single source of truth |
| Courses | EduAI | Instructors manage courses here |
| Course Enrollment | EduAI | Student roster managed here |
| Topics | EduAI | Course-scoped topic taxonomy |
| Materials / RAG | EduAI | Document upload, chunking, embeddings |
| AI Models / Providers | EduAI | Model selection and inference |
| AI Chat | EduAI | All AI interactions via `/api/chat` |
| Usage Logging | EduAI | Cross-extension analytics |
| Canvas Integration | EduAI | Centralized Canvas credentials and operations (Epic #59) |
| **Shared Question/Exercise Bank** | EduAI (Hosted) | Questions shared by Tutor + QM — *see Decision #3* |
| **Chat/Session History** | EduAI (Hosted) | Unified chat history |
| Tutoring Sessions & Analytics | AI Tutor | Specific to tutoring workflow |
| Modules / Lessons / Activities | AI Tutor | Content hierarchy |
| Submissions & Grading | AI Tutor | Student attempts, feedback |
| Prompt Templates | AI Tutor | Tutoring-specific |
| Questions / Variants | Question Maker | Question bank, variant workflows |
| Assessments | Question Maker | Quiz/test building |
| Canvas Quiz Export/Import | Question Maker | Assessment delivery — routes through EduAI Canvas credentials |
| OCR / Document Extraction | Question Maker | QM-specific feature |

---

### 2.2 Data Flow After Centralization

```
              ┌────────────────────────────────────────────┐
              │                EduAI                  │
              │                                            │
              │  ┌───────────┐  ┌──────────┐  ┌────────┐  │
              │  │   Auth    │  │ Courses  │  │  RAG   │  │
              │  │  (OIDC)   │  │  Users   │  │  Chat  │  │
              │  └───────────┘  └──────────┘  └────────┘  │
              └──────────────────┬─────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
        ┌───────────▼──────────┐  ┌───────────▼───────────┐
        │       AI Tutor       │  │     Question Maker     │
        │                      │  │                        │
        │  - Activities        │  │  - Questions           │
        │  - Submissions       │  │  - Variants            │
        │  - Analytics         │  │  - Assessments         │
        │  - Prompt Templates  │  │  - Canvas Quiz         │
        └──────────────────────┘  └────────────────────────┘

  Each extension calls EduAI for:
  OAuth/OIDC | Courses API | Enrollments API | Topics API | AI Chat API | Canvas API

  Course-Aware Chat lives in EduAI — no separate migration needed
```

---

## 3. Gap Analysis — Work Required

### 3.1 Question Maker (Largest Gap)

| ID | Gap | Effort | Priority |
|----|-----|--------|----------|
| QM-1 | **Auth migration:** Remove local JWT auth. Implement EduAI OAuth/OIDC using Better Auth (same pattern as AI Tutor). | Large | Critical |
| QM-2 | **Remove local users table:** Derive user identity from EduAI OAuth claims only. Remove registration/login endpoints. | Medium | Critical |
| QM-3 | **Course reference:** Remove local `courses` table. Questions and assessments reference EduAI course IDs directly. | Medium | High |
| QM-4 | **Topic reference:** Remove local topic storage. Fetch from EduAI on-demand. | Small | High |
| QM-5 | **API key scope:** Currently uses a shared admin API key for all EduAI calls. After OAuth migration, user-scoped calls should use the user's Bearer token. | Small | High |
| QM-6 | **Canvas credentials:** Currently stored locally per-user. Migrate to EduAI centralized Canvas management (see Decision #4). | Medium | High |
| QM-7 | **Direct AI provider calls:** Question generation still dispatches directly to Groq, OpenAI, or DeepSeek — route it through Core instead. OCR extraction and variant generation are already centralized. The legacy extraction and topic-assignment functions are dead code and can be deleted. | Medium | High |
| QM-8 | **Bug reporting:** QM owns `bugReportService.js` and `schema/BugReport.js` — a duplicate of AI Tutor's bug-report flow. See Decision #5. | Small | Low |

---

### 3.2 AI Tutor (Moderate Gap)

| ID | Gap | Effort | Priority |
|----|-----|--------|----------|
| AT-1 | **Course sync staleness:** One-time import means roster/topic changes don't propagate. Decision needed on sync model (see Decision #1). | Medium | High |
| AT-2 | **Local user mirror:** Local `User` table duplicates EduAI data. Could be removed and fetched from EduAI on each request, or kept as a read-through cache. | Small | Low |
| AT-3 | **Bug reporting:** AI Tutor owns `services/bugReports.js`, `routes/bugReports.js`, and `utils/bugReportMappers.js` — identical in structure to QM's bug-report flow. See Decision #5. | Small | Low |

---

### 3.3 EduAI — API Gaps

EduAI needs these new or updated endpoints for extensions to depend on:

| ID | Endpoint | Status | What's Needed |
|----|----------|--------|---------------|
| EC-1 | `GET /api/courses` | Partial | Currently **admin-only**. Must filter by role: professors see their own courses, students see enrolled courses. |
| EC-2 | `GET /api/courses/:id` | Partial | Needs role-based access: professors own, students enrolled. |
| EC-3 | `GET /api/courses/:id/enrollments` | In Progress — `feature/enrollment-api` | Being built in the `feature/enrollment-api` branch. AI Tutor needs this for enrollment sync. |
| EC-4 | `POST /api/courses/:id/enrollments` | Missing | Programmatic enrollment management (for Canvas sync + admin use). |
| EC-5 | `DELETE /api/courses/:id/enrollments/:userId` | Missing | Unenrollment |
| EC-6 | `GET /api/me` | Exists | Returns authenticated user profile. Works for extension OAuth sessions. |
| EC-7 | `GET /api/courses/:id/topics` | Exists | Already used by AI Tutor. |
| EC-8 | `POST /api/courses/:id/topics` | Exists | Topic management. |
| EC-9 | `GET /api/ai-models` | Exists | AI Tutor already uses this. |
| EC-10 | OAuth/OIDC for sister apps | In Progress — PRs #48, #49, #51, #50 | OAuth provider foundation (#48), Better Auth API key schema fix (#49), OAuth bearer auth for sister app API access (#51), Admin sister app registration UI (#50). These open PRs cover the EduAI side of auth. Question Maker still needs to be registered as a client once they land. |
| EC-11 | Canvas credential management | Missing | Centralized Canvas connection per user — needed once Decision #4 is resolved. |
| EC-12 | Bug report endpoints | Missing | `POST /api/bug-reports`, `GET /api/admin/bug-reports`, `PATCH /api/admin/bug-reports/:id/status` — needed only if Decision #5 approves consolidation. |

---

### 3.4 Within-Extension Cleanup (Parallel Track)

Code duplication found via jscpd. All items below are within a single extension with no cross-repo dependency and can run in parallel with consolidation work.

| Repo | Item |
|------|------|
| AI Tutor | Backend resource routes repeat validation, auth-check, and error-handling blocks — extract to middleware or a route-utils helper |
| AI Tutor | Student/instructor route pairs share read-only display structure — extract shared components (do not merge the route files; they diverge on permissions) |
| Question Maker | Canvas export and import dialogs share ~8 blocks — extract a shared base dialog component |
| Question Maker | Assessment service and question service overlap — run a focused diff first; only extract what's genuinely shared |
| Question Maker | `createdAt`/`updatedAt` declared manually in every Sequelize schema file — Sequelize's `timestamps: true` handles this automatically |
| EduAI | 4 auth routes are likely legacy duplicates — audit and delete dead ones before CWL migration reshapes this surface |
| EduAI | Admin table/dialog pairs share layout — extract shared components |
| EduAI | 47 CRUD route clones — extract shared error-mapping, pagination, and response-shape helpers into a route-utils module |

---

## 4. API Contracts

These contracts must be defined, stubbed, and test-covered before extension teams begin integration. They are the shared agreement between Core (Group 1) and Extensions (Group 3).

### Contract 1: Authentication

Every extension authenticates users via EduAI OAuth/OIDC.

```
Discovery:     GET  {EDUAI_URL}/api/auth/.well-known/openid-configuration
Authorization: GET  {EDUAI_URL}/api/auth/oauth2/authorize
Token:         POST {EDUAI_URL}/api/auth/oauth2/token
UserInfo:      GET  {EDUAI_URL}/api/auth/oauth2/userinfo
```

**Standardized token claims:**
```json
{
  "sub": "user_cuid",
  "email": "user@example.com",
  "name": "User Name",
  "picture": "https://...",
  "https://eduai.app/role": "STUDENT | PROFESSOR | TA | ADMIN"
}
```

**Each extension registers its own OAuth client** with a unique `client_id` and `client_secret` in EduAI's config.

---

### Contract 2: Course Access

```
GET    /api/courses                        # Role-filtered list
GET    /api/courses/:id                    # Single course (with role check)
GET    /api/courses/:id/topics             # Topics for a course
GET    /api/courses/:id/enrollments        # Student roster (professor/admin only)
POST   /api/courses/:id/enrollments        # Enroll a student
DELETE /api/courses/:id/enrollments/:uid   # Unenroll a student
```

**Course response shape:**
```json
{
  "id": "clxxxxxxxxxxxxx",
  "name": "CPSC 110",
  "description": "...",
  "instructorId": "...",
  "isPublished": true,
  "topics": [...],
  "enrollmentCount": 42
}
```

**Role filtering rules:**
- `ADMIN` — sees all courses
- `PROFESSOR` — sees courses where they are the instructor
- `TA` — sees courses where they are assigned as TA
- `STUDENT` — sees courses where they have an active enrollment

---

### Contract 3: AI Chat

All AI interactions from extensions go through this endpoint.

```
POST /api/chat
Headers: Authorization: Bearer {user_access_token}
         OR x-api-key: {admin_api_key}  +  body.proxyUser (for service-level calls)

Body:
{
  "message":  "...",
  "chatId":   "...",      // Optional — resume existing conversation
  "courseId": "...",      // Optional — enables RAG on course materials
  "modelId":  "..."       // Optional — model selection
}
```

---

### Contract 4: User Profile

```
GET /api/me
Headers: Authorization: Bearer {access_token}

Response:
{
  "id": "...",
  "email": "...",
  "name": "...",
  "image": "...",
  "role": "STUDENT | PROFESSOR | TA | ADMIN"
}
```

---

## 5. Migration Plan

### Phase 1: Auth Centralization (Weeks 2–3, May 11–21)

**Goal:** Every extension authenticates users through EduAI. No more standalone accounts in Question Maker.

**EduAI tasks:**
> Note: PRs #48, #49, #51, and #50 are open and cover the OAuth provider foundation, API key schema, bearer auth for sister apps, and admin registration UI. The EduAI side of auth is largely being handled by these. Monitor their merge order before starting Question Maker integration.
- [ ] Once PRs #48–#51 land, register Question Maker as a new OAuth client
- [ ] Verify OIDC discovery returns correct metadata for Question Maker's client
- [ ] Verify `/api/auth/oauth2/userinfo` returns the role claim correctly

**Question Maker tasks (mirror AI Tutor's pattern):**
- [ ] Install `better-auth` with `genericOAuth` plugin
- [ ] Configure OIDC discovery pointing to `EDUAI_OIDC_URL`
- [ ] Replace JWT `authenticateToken` middleware with Better Auth session middleware
- [ ] Replace `/api/auth/register` and `/api/auth/login` with OAuth redirect
- [ ] Remove local `users` table and `password_hash` fields
- [ ] Map OAuth claims to local user context (copy `normalizeEduAiRole` from AI Tutor)

**Reference files (AI Tutor template):**
- `AI-Tutor/server/src/auth.js` — OAuth config
- `AI-Tutor/server/src/middleware/auth.js` — session middleware
- `AI-Tutor/server/src/services/eduaiAuth.js` — token refresh

---

### Phase 2: Course Data Centralization (Weeks 3–5, May 22–Jun 4)

**Goal:** Extensions read course/enrollment/topic data from EduAI. No independently-managed course copies.

**EduAI tasks:**
- [ ] Update `GET /api/courses` and `GET /api/courses/:id` with role-based filtering (EC-1, EC-2)
- [ ] Build `GET /api/courses/:id/enrollments` endpoint (EC-3) — in progress on `feature/enrollment-api`, track and test once merged
- [ ] Build `POST /api/courses/:id/enrollments` and `DELETE` (EC-4, EC-5)
- [ ] Ensure topics endpoints are accessible by non-admin authenticated users

**Question Maker tasks:**
- [ ] Remove local `courses` and `topics` tables
- [ ] Update all questions/assessments/sections to store `eduaiCourseId` (EduAI's CUID) as the course reference instead of a local FK
- [ ] Fetch course context from `GET /api/courses/:id` on-demand
- [ ] Update `GET /api/eduai/courses` proxy to use the user's Bearer token (not shared API key)

**AI Tutor tasks (see Decision #1):**
- [ ] Evaluate import model vs. live fetch and implement the chosen approach
- [ ] If keeping import model: document known limitation (staleness) and expected re-sync flow

---

### Phase 3: Integration Sprint (Weeks 7–8, Jun 12–25)

**Goal:** End-to-end demo. A single user logs in and sees the same courses in all three extensions.

- [ ] All three extensions authenticated via EduAI OIDC
- [ ] Question Maker using EduAI course IDs as foreign keys
- [ ] AI Tutor course sync updated per decision made in Phase 2
- [ ] Demo flow: login → navigate to AI Tutor → navigate to Question Maker → same identity, same courses visible
- [ ] Shared question bank schema finalized (whether or not implementation starts — see Decision #3)

---

## 6. Key Decisions for This Meeting

The options below are starting points for discussion, not final answers. If someone on the team has a different approach or sees a problem with an option, that should be raised and considered. The goal of this section is to make sure the team leaves the meeting aligned on a direction for each item.

---

### Decision 1: AI Tutor Course Sync — Keep Import Model or Move to Live Fetch?

**Option A: Keep import model** (current behavior)
- Instructor clicks "import course" once; AI Tutor syncs metadata, enrollments, and topics locally.
- + Simple, resilient — works even if EduAI is temporarily down
- - Stale data risk — roster changes in EduAI don't propagate until re-imported
- - Instructor must manually re-sync after course updates

**Option B: Live fetch**
- AI Tutor fetches course/enrollment/topic data from EduAI on every request.
- + Always fresh, no sync step
- - Every request depends on EduAI being up; latency added
- - Requires a caching layer, error handling, and graceful degradation

**Option C: Hybrid — import + TTL cache**
- Import on first use; background refresh every N hours or on instructor demand.
- + Balances freshness and resilience
- - Most complex to implement correctly

---

### Decision 2: What is the Canonical Course ID in Question Maker?

When Question Maker's questions and assessments reference a "course," what should that ID be?

**Option A: EduAI course ID** (CUID string) as the FK — eliminates the local course table entirely

**Option B: Keep local course table** as a reference layer that maps to EduAI IDs — more indirection, but extensions remain more self-contained

---

### Decision 3: Shared Question/Exercise Bank — In Scope This Summer?

Per the architecture, a "Shared question/exercise bank (Tutor + QM)" is a **hosted service** in EduAI. Both AI Tutor's Activities and Question Maker's Questions/Variants conceptually serve similar purposes.

**Option A: In scope this summer**
- Design and build the shared schema in EduAI
- Migrate AI Tutor Activities and QM Questions/Variants into it
- Both extensions read/write through EduAI
- Note: Significant effort — involves schema migration in two separate extensions with different data models

**Option B: Design now, implement later**
- Define the shared question bank schema during the architecture phase
- Each extension keeps its own question format for the pilot
- Plan the migration for post-pilot when there is more time to do it carefully

**Open question (independent of timing):** How should instructors control which questions are visible to AI Tutor vs. staying internal to QM? One option is a `testable` flag on the question — instructors mark items as testable in QM, and Core filters by that flag when AI Tutor queries. This needs to be decided during schema design regardless of which option above is chosen. 

---

### Decision 4: How Should Canvas Be Centralized?

Canvas credentials and operations should go through EduAI. The question is how:

**Option A: EduAI manages credentials and proxies all Canvas operations**
- User connects Canvas once in EduAI
- Question Maker calls EduAI API to perform Canvas operations (quiz export/import)
- EduAI owns all Canvas-related endpoints and acts as a Canvas proxy for all extensions
- Cleanest separation — no extension talks to Canvas directly

**Option B: EduAI stores credentials; extensions retrieve and use them directly**
- User connects Canvas once in EduAI
- Extensions retrieve the user's Canvas token from EduAI and make Canvas calls directly
- Simpler API surface on EduAI, but Canvas logic remains in each extension

**Option C: Shared credential storage with extension-specific Canvas logic**
- EduAI stores and exposes the Canvas API key per user
- Each extension is responsible for its own Canvas operations using that shared key
- Middle ground between A and B

---

### Decision 5: Bug Reporting — Consolidate into Core or Keep Per-Extension?

Both AI Tutor and Question Maker have identical bug-report flows: same 3 statuses, same admin triage console, same frontend hook pattern (see QM-8, AT-3).

**Option A: Consolidate into Core**
- Core owns a `BugReport` table with a `source` field (`"ai-tutor" | "question-maker"`)
- Extensions delete their backend service and schema; keep only the frontend hook pointed at Core
- Core exposes: `POST /api/bug-reports`, `GET /api/admin/bug-reports`, `PATCH /api/admin/bug-reports/:id/status`
- One wrinkle: AI Tutor validates a course→module→lesson hierarchy in bug context; QM has no course context — Core endpoint needs an optional `context` block
- + Single admin triage console, no duplicate logic
- - Additional Core scope this summer

**Option B: Keep Per-Extension**
- Extensions own their bug-report services; no change needed
- + Lower effort and risk
- - Duplicate admin consoles, duplicate logic to maintain

---

### Decision 6: Subdomain Strategy and Session Cookie Sharing

If extensions run on `qm.eduai.com` / `ai-tutor.eduai.com`, a `Domain=.eduai.com` cookie from Core is shared — no re-auth when users navigate between extensions. If they run on separate domains, an explicit token-exchange step is needed.

This affects the Phase 1 auth implementation (§5) and should be decided before that work starts.

---

### Decision 7: QM ORM — Keep Sequelize or Migrate to Prisma?

Core and AI Tutor use Prisma; QM uses Sequelize. This affects every QM backend task this summer and needs to be a stated decision before that work begins.

**Option A: Keep Sequelize**
- + No migration cost; QM team can focus on consolidation work
- + Validates the API-first architecture — QM stays a separate stack that talks to Core over HTTP
- - Developers context-switching between two ORMs
- - Any shared schema work that lands in QM would need to be re-migrated later

**Option B: Migrate to Prisma**
- + One ORM across all three repos; easier developer mobility and consistent query patterns
- - Migration on top of the auth rewrite multiplies risk for no functional gain in the pilot
- - Significant effort that could delay QM consolidation work

---

## 7. Week-by-Week Checklist

### Week 2 (May 11–14): Foundation

- [ ] **EduAI:** Monitor PRs #48, #49, #51, #50 (OAuth foundation) — these must land before Question Maker auth integration starts
- [ ] **EduAI:** Once PRs #48–#51 are merged, register Question Maker as an OAuth client
- [ ] **EduAI:** Audit `GET /api/courses` — confirm role-based filtering is needed, spec the change
- [ ] **EduAI:** Track `feature/enrollment-api` (`GET /api/courses/:courseId/enrollments`) — review and test once merged
- [ ] **EduAI:** Delete duplicate marketing pages (landing, team, header, footer, nav, welcome) — confirm no app routes import them first; verify `/` redirects to `/dashboard` or `/login` after deletion
- [ ] **Question Maker:** Confirm whether the direct provider call functions in the AI service are dead code or still live — resolves QM-7
- [ ] **Group 5 (Testing):** Write API contract test suites for Contracts 1–4 above
- [ ] **Question Maker:** Begin Better Auth + EduAI OIDC setup (mirror AI Tutor pattern)

### Weeks 3–4 (May 15–28): Auth Centralization

- [ ] **Question Maker:** Role naming decisions (Section 5 of the User Management doc) must 
be made before auth migration begins — this feeds directly into Contract 1, as QM will implement against it
- [ ] **Question Maker:** Complete OAuth migration; remove local auth endpoints
- [ ] **Question Maker:** Remove local `users` table; derive user from OAuth session
- [ ] **EduAI:** Verify Question Maker OAuth client working end-to-end
- [ ] **AI Tutor:** Audit current auth and document any edge cases found

### Weeks 5–6 (May 29–Jun 11): Course Data Centralization

- [ ] **EduAI:** Deploy centralized API v1 (role-filtered courses + enrollments endpoints)
- [ ] **Question Maker:** Update question/assessment FKs to use EduAI course IDs; remove local course/topic tables
- [ ] **AI Tutor:** Implement sync model decision from Phase 2
- [ ] **All:** Integration tests across auth + course data endpoints

### Weeks 7–8 (Jun 12–25): Integration Sprint

- [ ] All three extensions authenticated via EduAI
- [ ] Question Maker using EduAI for all user/course context
- [ ] End-to-end demo: single login → same identity and courses visible in all extensions
- [ ] Shared question bank schema documented (even if not yet implemented)

---

## 8. Tech Notes

### How AI Tutor Implements EduAI OAuth (Template for Question Maker)

```javascript
// AI-Tutor/server/src/auth.js
export const auth = betterAuth({
  plugins: [
    genericOAuth({
      config: [{
        providerId: "eduai",
        discoveryUrl: process.env.EDUAI_DISCOVERY_URL,
        clientId: process.env.EDUAI_CLIENT_ID,
        clientSecret: process.env.EDUAI_CLIENT_SECRET,
        scopes: ["openid", "profile", "email"],
        mapProfileToUser: (profile) => ({
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          role: normalizeEduAiRole(profile["https://eduai.app/role"]),
        }),
      }],
    }),
  ],
});
```

### How Question Maker Currently Calls EduAI

```javascript
// Question-Maker/app/backend/src/services/eduaiService.js
const eduaiApi = axios.create({
  baseURL: process.env.EDUAI_API_URL,
  headers: { 'x-api-key': process.env.EDUAI_API_KEY }  // admin key — not user-scoped
});
```

After auth migration, user-scoped requests should use the user's Bearer token forwarded from the session, not a shared admin API key.

### EduAI: Adding Role-Filtered Course Access

The current `GET /api/courses` endpoint in `app/routes/api/courses.$.ts` is admin-only. The fix is to add a role check that returns:
- For `PROFESSOR`: `WHERE instructorId = userId`
- For `STUDENT`: `WHERE enrollments.some(studentId = userId, isActive = true)`
- For `TA`: `WHERE courseTAs.some(userId = userId)`
- For `ADMIN`: all courses (current behavior)

---

## 9. Out of Scope for This Epic

| Item | Where It Belongs |
|------|-----------------|
| CWL/SSO integration | Epic #59. Auth centralization works with email/password first; CWL drops in as another EduAI auth method later. |
| Canvas roster/materials sync | Epic #59. |
| Full role system (Dept Admin, permissions matrix) | Epic #60. This epic depends on roles existing but does not define them. |
| Shared question bank migration | Deferred pending Decision #3. Schema design happens now; migration later. |
| Load balancing / performance | Epic #63, Phase 3. |
| MCP Host Server | Post-pilot, September onward. |
| Unified instructor dashboard | One consolidated dashboard vs. three separate ones with hyperlinks vs. defer post-pilot — decision needed before UX work begins. |

---

## 10. File Reference

| File | Purpose |
|------|---------|
| `AI-Tutor/server/src/auth.js` | EduAI OAuth setup — template for QM migration |
| `AI-Tutor/server/src/middleware/auth.js` | Session middleware — template for QM |
| `AI-Tutor/server/src/services/eduaiClient.js` | HTTP client for EduAI API calls |
| `AI-Tutor/server/src/services/eduaiAuth.js` | Token refresh handling |
| `AI-Tutor/server/src/services/enrollmentSync.js` | Current course import flow |
| `EduAICore/app/routes/api/courses.$.ts` | Course API endpoints (needs role filtering update) |
| `EduAICore/app/routes/api/courses.id.ts` | Single course endpoint |
| `EduAICore/app/routes/api/courses.topics.$.ts` | Topics endpoint |
| `EduAICore/app/lib/auth/` | EduAI auth setup (OAuth provider) |
| `EduAICore/prisma/schema.prisma` | Database schema (CourseEnrollment, User, etc.) |
| `Question-Maker/app/backend/src/auth.js` | Current local JWT auth (to be replaced) |
| `Question-Maker/app/backend/src/services/eduaiService.js` | Current EduAI API client |
| `Question-Maker/app/backend/prisma/schema.prisma` | QM schema (users/courses tables to be removed) |

---

## 11. Known Challenges

### Local Development Setup

Running the full stack locally means running EduAI, AI Tutor, and Question Maker simultaneously — each with its own server process and database. This is more complex than the typical single-service setup most developers are used to.

**OAuth across localhost ports**  
The OIDC flow involves real browser redirects between services. Locally this means every service must be running on a known, fixed port, and CORS plus cookie domain settings must be explicitly configured for localhost. Session cookies in particular can behave differently when crossing ports (e.g., `localhost:5174` to `localhost:3000`) depending on the browser. This needs to be tested and documented for every developer's first setup.

**Multiple databases**  
Each service has its own PostgreSQL database. Local setup requires initializing all three databases and keeping their schemas in sync as migrations are added. A new developer joining mid-project needs to run three separate schema setups, not one.

**Environment variable coordination**  
Three separate repos each have `.env` files that need to reference each other. For example, `EDUAI_BASE_URL` in both AI Tutor and Question Maker must point to whatever port EduAI is running on locally. If a developer changes EduAI's port, they have to update env files in two other repos. This is easy to get wrong silently — a misconfigured URL produces auth failures that can look like code bugs.

**No shared local startup**  
Currently each service has its own Docker or npm run dev setup. There is no single command to start the whole stack. A shared `docker-compose.yml` at the monorepo root (or a simple shell script) would reduce friction significantly and is worth creating early.

### Integration Testing

Testing a cross-service flow — for example, a user logging into Question Maker via EduAI then generating a question — requires all three services running and correctly configured. This is harder to set up in CI than a single-service test.

Unit tests for services that call EduAI's API will need stubs or mocks. The API contract test suites written in Week 1 serve this purpose: they define the expected shape of every response so extension teams can mock against a known contract rather than guessing. But this only works if the stubs are kept in sync with the real API as it evolves.

EduAI currently has no tests. This is the most urgent blocker for the centralization work, and should be done before anything else. Since extensions are about to depend on Core's API, any changes to any endpoint will have no way to check prematurely for failures. Writing contract tests for Contracts 1-4 must be the first task completed in Week 2, before any other integration work begins.

Testing OAuth flows is also harder to automate. Most approaches either bypass the full flow in test mode (e.g., a test-only endpoint that issues a session directly) or run a real OAuth server in the test environment. The team should agree on which approach to use before writing auth-dependent tests.

### API Contract Drift

As EduAI's API evolves, extension teams must be notified of breaking changes. A change to a response shape or a renamed field in EduAI can silently break AI Tutor or Question Maker — and the failure may not show up until someone tests the integration manually. The contract test suites from Week 1 are the main defense here, but only if they are treated as a shared responsibility and updated whenever EduAI's API changes.

---

## 12. Monorepo

EduAI, AI Tutor, and Question Maker will be consolidated into a single repository managed by **Turborepo** with separate package manager workspaces. This decision resolves several of the structural friction points described in §11 and sets the foundation for the shared infrastructure this epic depends on.

---

### Why This Addresses Our Current Pain Points

Several problems described elsewhere in this document are structural — they stem from operating three separate repositories, not from code quality or process issues. The monorepo directly resolves:

- **Auth + course data sync complexity (§11):** Cross-service environment variable coordination, diverging `.env` files, and silent misconfiguration failures go away when all services share a root configuration.
- **No shared local startup (§11):** A single `docker-compose.yml` at the monorepo root starts the full stack with one command.
- **API contract drift (§11):** Shared TypeScript types for `Course`, `User`, `Enrollment`, and API response shapes live in an internal package imported by all three services — no more manually keeping definitions in sync across repos.
- **Dependency hell:** Synchronized versions of `react-router`, `better-auth`, and `prisma` are managed at the root level. The current situation — where Core and AI Tutor use Prisma while Question Maker uses Sequelize, and auth spans both `better-auth` and JWT — is a direct consequence of three repos diverging independently.
- **UI inconsistency:** Changes to shared components (Button, Dialog, etc.) in Core currently don't propagate to Tutor or Question Maker. A shared UI package fixes this structurally.
- **Code duplication:** Project information, marketing copy, and foundational components are currently duplicated across repos. Fixing a typo today requires two PRs and two deployment pipelines.

---

### What the Monorepo Is (and Is Not)

A monorepo does **not** mean the services become a monolith. Each extension remains a separately deployable application with its own server, database, and build process. Turborepo is designed exactly for this pattern — isolated applications that consume shared internal packages, with per-app build and deploy pipelines.

---

### Target Repository Structure

```
EduAI/
├── apps/
│   ├── core/            # EduAI (migrated from EduAI-Core)
│   ├── extensions/
│   ├──── tutor/           # AI Tutor (migrated from AI-Tutor)
│   └──── question-maker/  # Question Maker (migrated from Question-Maker)
└── packages/
    ├── config/          # Shared tsconfig, ESLint, Prettier
    ├── db/              # Shared Prisma schema and client
    ├── auth/            # Centralized auth implementation
    └── ui/              # Shared Tailwind component library
```

**`packages/db`** is the single source of truth for the Prisma schema and generated client. All three apps query against the same database definitions with guaranteed TypeScript type safety — no more schema drift between services.

**`packages/auth`** consolidates the current split between `better-auth` (Core, AI Tutor) and JWT (Question Maker) into a single implementation. This is a direct prerequisite for §5 Phase 1 (Auth Centralization).

**`packages/ui`** extracts shared Tailwind/React components so a change to Button or Dialog is built once and propagates everywhere — resolving the UI inconsistency described in §3.4.

**`packages/config`** manages ESLint, Prettier, and TypeScript configurations at the root level, with all apps extending shared configs via atomic, non-breaking PRs.

Each app-level project **can** (but not necessarily will) have its own database schemas and components.

---

### Migration Phases

The migration is executed incrementally so the team is never blocked from feature work. Each phase is independently deployable and non-breaking.

#### Phase 1: Lift and Shift
Initialize the `EduAI` shell using Turborepo and move the three existing repositories directly into `apps/` — no logic changes. Apps retain their individual `package.json` files and build processes. The team immediately switches to pushing code to the new repository.

This phase is intentionally fast. We allocate a small, fixed window of time to complete it, minimizing disruption to ongoing work.

#### Phase 2: Unify Tooling
Create `packages/config` and extract the root `tsconfig.json`, Prettier, and ESLint configurations. Update all three apps to extend the shared configs via atomic PRs. No functional changes.

#### Phase 3: Core Infrastructure Extraction
- Create `packages/db` and migrate `schema.prisma` from EduAI. This is the enabler for the shared Prisma client that all apps will consume.
- Create `packages/auth` and centralize the auth implementation. This directly supports §5 Phase 1 — the Question Maker auth migration depends on this package existing.
- Refactor apps one-by-one to drop local DB/auth logic and import the shared internal packages.

#### Phase 4: Shared UI Library
Create `packages/ui` and incrementally move common UI wrappers and Tailwind elements out of `apps/core/components` into the shared library. Update app imports to use the unified design system. This resolves the component drift described in §3.4.

---

### Relationship to This Epic's Timeline

The Lift and Shift (Phase 1) should happen **before Week 2 work begins** — it has no dependencies and unblocks everything else by giving the team a single place to push code. Phases 2 and 3 run in parallel with the auth and course data centralization work in §5, with `packages/auth` and `packages/db` being the direct enablers for those migrations. Phase 4 (UI library) is lower priority and can follow the integration sprint.

The `docker-compose.yml` and shared API type package described in §11 have a natural home in this structure and should be created during Phase 1 as part of the shell setup — capturing the local dev benefit immediately without waiting for the full infrastructure extraction.