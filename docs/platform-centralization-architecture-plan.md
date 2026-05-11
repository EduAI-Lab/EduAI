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
- [12. Considerations](#12-considerations)

---

## 0. TL;DR

Everything **shared** across AI Tutor, Question Maker, and Course-Aware Chat must go through **EduAI Core's API**. Anything specific to one extension stays in that extension.

Today the three extensions were built independently. Each has its own auth, its own copy of user/course data, and its own way of managing things. This causes duplication, inconsistency, and makes central management impossible (e.g., a student's enrollment change in EduAI Core should propagate everywhere — not require a manual re-sync in each extension).

---

## 1. Current State — What We Have

### 1.1 EduAI Core

The central platform. Already owns:

- **Auth:** Better Auth (email/password + API keys). Acts as an **OAuth 2.0 / OIDC provider** — extensions can authenticate users through EduAI Core.
- **Users & Roles:** Admin, Professor, TA, Student
- **Courses:** Full course management (create, enroll, TA assignment, topics)
- **Materials / RAG:** Document upload, chunking, vector embeddings, semantic search (PGVector)
- **Chat / AI:** Streaming chat with RAG, multi-model support (OpenAI, Google, Ollama)
- **AI Models:** Dynamic model registry with per-provider config
- **Usage Logging:** AI interaction logs

> **Note:** Course-Aware Chat lives **in** EduAI Core. The `/chat` route in this repo is the Course-Aware Chat experience. It does not live in a separate repo.

---

### 1.2 AI Tutor — Current Integration Status

| Domain | Status | Notes |
|--------|--------|-------|
| Auth | Centralized | Uses EduAI Core's OAuth/OIDC (Better Auth genericOAuth plugin) |
| AI Chat | Centralized | Proxies all AI calls through `POST /api/chat` on EduAI Core |
| AI Models | Centralized | Fetches model list from EduAI Core |
| Courses | Partial — one-time sync | Instructors manually "import" a course (copies metadata + enrollments + topics into AI Tutor's local DB). **Changes in EduAI Core don't auto-propagate.** |
| Users | Partial — local mirror | Has its own `User` table, but populated from EduAI OAuth claims. It's a projection of EduAI data, not a second source of truth. |
| Activities / Content | AI Tutor-specific | Modules, Lessons, Activities, Submissions, Analytics — stay in AI Tutor |
| Prompt Templates | AI Tutor-specific | Stays in AI Tutor |

---

### 1.3 Question Maker — Current Integration Status

| Domain | Status | Notes |
|--------|--------|-------|
| Auth | Not integrated | Fully standalone JWT auth with local user registration. **No integration with EduAI Core.** |
| Users | Local only | Local `users` table with bcrypt passwords. Completely separate from EduAI. |
| Courses | Partial — reference only | Local `courses` table. Instructors can call `GET /api/eduai/courses` to list EduAI courses for reference, but local courses are entirely separate. |
| Topics | Partial — reference only | Fetched from EduAI on-demand but stored locally for FK associations. |
| AI Chat / Question Generation | Centralized | Proxies through EduAI Core API (via `/api/eduai/*` endpoints) |
| Questions / Variants | QM-specific | Question bank, variant workflows, assessment building — stay in Question Maker |
| Assessments | QM-specific | Quiz/test building, section management — stays in Question Maker |
| Canvas Quiz Export/Import | QM-specific | Quiz delivery via Canvas — currently standalone, to be centralized (see Decision #4) |

---

## 2. Target State — What We're Building Toward

### 2.1 Ownership Map

| Domain | Owned By | Notes |
|--------|----------|-------|
| Authentication / Sessions | EduAI Core | Single sign-on for all extensions |
| User Accounts & Roles | EduAI Core | Single source of truth |
| Courses | EduAI Core | Instructors manage courses here |
| Course Enrollment | EduAI Core | Student roster managed here |
| Topics | EduAI Core | Course-scoped topic taxonomy |
| Materials / RAG | EduAI Core | Document upload, chunking, embeddings |
| AI Models / Providers | EduAI Core | Model selection and inference |
| AI Chat | EduAI Core | All AI interactions via `/api/chat` |
| Usage Logging | EduAI Core | Cross-extension analytics |
| Canvas Integration | EduAI Core | Centralized Canvas credentials and operations (Epic #59) |
| **Shared Question/Exercise Bank** | EduAI Core (Hosted) | Questions shared by Tutor + QM — *see Decision #3* |
| **Chat/Session History** | EduAI Core (Hosted) | Unified chat history |
| Tutoring Sessions & Analytics | AI Tutor | Specific to tutoring workflow |
| Modules / Lessons / Activities | AI Tutor | Content hierarchy |
| Submissions & Grading | AI Tutor | Student attempts, feedback |
| Prompt Templates | AI Tutor | Tutoring-specific |
| Questions / Variants | Question Maker | Question bank, variant workflows |
| Assessments | Question Maker | Quiz/test building |
| Canvas Quiz Export/Import | Question Maker | Assessment delivery — routes through EduAI Core Canvas credentials |
| OCR / Document Extraction | Question Maker | QM-specific feature |

---

### 2.2 Data Flow After Centralization

```
              ┌────────────────────────────────────────────┐
              │                EduAI Core                  │
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

  Each extension calls EduAI Core for:
  OAuth/OIDC | Courses API | Enrollments API | Topics API | AI Chat API | Canvas API

  Course-Aware Chat lives in EduAI Core — no separate migration needed
```

---

## 3. Gap Analysis — Work Required

### 3.1 Question Maker (Largest Gap)

| ID | Gap | Effort | Priority |
|----|-----|--------|----------|
| QM-1 | **Auth migration:** Remove local JWT auth. Implement EduAI OAuth/OIDC using Better Auth (same pattern as AI Tutor). | Large | Critical |
| QM-2 | **Remove local users table:** Derive user identity from EduAI OAuth claims only. Remove registration/login endpoints. | Medium | Critical |
| QM-3 | **Course reference:** Remove local `courses` table. Questions and assessments reference EduAI Core course IDs directly. | Medium | High |
| QM-4 | **Topic reference:** Remove local topic storage. Fetch from EduAI Core on-demand. | Small | High |
| QM-5 | **API key scope:** Currently uses a shared admin API key for all EduAI calls. After OAuth migration, user-scoped calls should use the user's Bearer token. | Small | High |
| QM-6 | **Canvas credentials:** Currently stored locally per-user. Migrate to EduAI Core centralized Canvas management (see Decision #4). | Medium | High |

---

### 3.2 AI Tutor (Moderate Gap)

| ID | Gap | Effort | Priority |
|----|-----|--------|----------|
| AT-1 | **Course sync staleness:** One-time import means roster/topic changes don't propagate. Decision needed on sync model (see Decision #1). | Medium | High |
| AT-2 | **Local user mirror:** Local `User` table duplicates EduAI data. Could be removed and fetched from EduAI Core on each request, or kept as a read-through cache. | Small | Low |

---

### 3.3 EduAI Core — API Gaps

EduAI Core needs these new or updated endpoints for extensions to depend on:

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
| EC-10 | OAuth/OIDC for sister apps | In Progress — PRs #48, #49, #51, #50 | OAuth provider foundation (#48), Better Auth API key schema fix (#49), OAuth bearer auth for sister app API access (#51), Admin sister app registration UI (#50). These open PRs cover the EduAI Core side of auth. Question Maker still needs to be registered as a client once they land. |
| EC-11 | Canvas credential management | Missing | Centralized Canvas connection per user — needed once Decision #4 is resolved. |

---

## 4. API Contracts

These contracts must be defined, stubbed, and test-covered before extension teams begin integration. They are the shared agreement between Core (Group 1) and Extensions (Group 3).

### Contract 1: Authentication

Every extension authenticates users via EduAI Core OAuth/OIDC.

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

**Each extension registers its own OAuth client** with a unique `client_id` and `client_secret` in EduAI Core's config.

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

**Goal:** Every extension authenticates users through EduAI Core. No more standalone accounts in Question Maker.

**EduAI Core tasks:**
> Note: PRs #48, #49, #51, and #50 are open and cover the OAuth provider foundation, API key schema, bearer auth for sister apps, and admin registration UI. The EduAI Core side of auth is largely being handled by these. Monitor their merge order before starting Question Maker integration.
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

**Goal:** Extensions read course/enrollment/topic data from EduAI Core. No independently-managed course copies.

**EduAI Core tasks:**
- [ ] Update `GET /api/courses` and `GET /api/courses/:id` with role-based filtering (EC-1, EC-2)
- [ ] Build `GET /api/courses/:id/enrollments` endpoint (EC-3) — in progress on `feature/enrollment-api`, track and test once merged
- [ ] Build `POST /api/courses/:id/enrollments` and `DELETE` (EC-4, EC-5)
- [ ] Ensure topics endpoints are accessible by non-admin authenticated users

**Question Maker tasks:**
- [ ] Remove local `courses` and `topics` tables
- [ ] Update all questions/assessments/sections to store `eduaiCourseId` (EduAI Core's CUID) as the course reference instead of a local FK
- [ ] Fetch course context from `GET /api/courses/:id` on-demand
- [ ] Update `GET /api/eduai/courses` proxy to use the user's Bearer token (not shared API key)

**AI Tutor tasks (see Decision #1):**
- [ ] Evaluate import model vs. live fetch and implement the chosen approach
- [ ] If keeping import model: document known limitation (staleness) and expected re-sync flow

---

### Phase 3: Integration Sprint (Weeks 7–8, Jun 12–25)

**Goal:** End-to-end demo. A single user logs in and sees the same courses in all three extensions.

- [ ] All three extensions authenticated via EduAI Core OIDC
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
- + Simple, resilient — works even if EduAI Core is temporarily down
- - Stale data risk — roster changes in EduAI Core don't propagate until re-imported
- - Instructor must manually re-sync after course updates

**Option B: Live fetch**
- AI Tutor fetches course/enrollment/topic data from EduAI Core on every request.
- + Always fresh, no sync step
- - Every request depends on EduAI Core being up; latency added
- - Requires a caching layer, error handling, and graceful degradation

**Option C: Hybrid — import + TTL cache**
- Import on first use; background refresh every N hours or on instructor demand.
- + Balances freshness and resilience
- - Most complex to implement correctly

---

### Decision 2: What is the Canonical Course ID in Question Maker?

When Question Maker's questions and assessments reference a "course," what should that ID be?

**Option A: EduAI Core course ID** (CUID string) as the FK — eliminates the local course table entirely

**Option B: Keep local course table** as a reference layer that maps to EduAI IDs — more indirection, but extensions remain more self-contained

---

### Decision 3: Shared Question/Exercise Bank — In Scope This Summer?

Per the architecture, a "Shared question/exercise bank (Tutor + QM)" is a **hosted service** in EduAI Core. Both AI Tutor's Activities and Question Maker's Questions/Variants conceptually serve similar purposes.

**Option A: In scope this summer**
- Design and build the shared schema in EduAI Core
- Migrate AI Tutor Activities and QM Questions/Variants into it
- Both extensions read/write through EduAI Core
- Note: Significant effort — involves schema migration in two separate extensions with different data models

**Option B: Design now, implement later**
- Define the shared question bank schema during the architecture phase
- Each extension keeps its own question format for the pilot
- Plan the migration for post-pilot when there is more time to do it carefully

---

### Decision 4: How Should Canvas Be Centralized?

Canvas credentials and operations should go through EduAI Core. The question is how:

**Option A: EduAI Core manages credentials and proxies all Canvas operations**
- User connects Canvas once in EduAI Core
- Question Maker calls EduAI Core API to perform Canvas operations (quiz export/import)
- EduAI Core owns all Canvas-related endpoints and acts as a Canvas proxy for all extensions
- Cleanest separation — no extension talks to Canvas directly

**Option B: EduAI Core stores credentials; extensions retrieve and use them directly**
- User connects Canvas once in EduAI Core
- Extensions retrieve the user's Canvas token from EduAI Core and make Canvas calls directly
- Simpler API surface on EduAI Core, but Canvas logic remains in each extension

**Option C: Shared credential storage with extension-specific Canvas logic**
- EduAI Core stores and exposes the Canvas API key per user
- Each extension is responsible for its own Canvas operations using that shared key
- Middle ground between A and B

---

## 7. Week-by-Week Checklist

### Week 2 (May 11–14): Foundation

- [ ] **EduAI Core:** Monitor PRs #48, #49, #51, #50 (OAuth foundation) — these must land before Question Maker auth integration starts
- [ ] **EduAI Core:** Once PRs #48–#51 are merged, register Question Maker as an OAuth client
- [ ] **EduAI Core:** Audit `GET /api/courses` — confirm role-based filtering is needed, spec the change
- [ ] **EduAI Core:** Track `feature/enrollment-api` (`GET /api/courses/:courseId/enrollments`) — review and test once merged
- [ ] **Group 5 (Testing):** Write API contract test suites for Contracts 1–4 above
- [ ] **Question Maker:** Begin Better Auth + EduAI OIDC setup (mirror AI Tutor pattern)
- [ ] **Team Leads:** Decisions 1–4 resolved in this meeting — you are here

### Weeks 3–4 (May 15–28): Auth Centralization

- [ ] **Question Maker:** Role naming decisions (Section 5 of the User Management doc) must 
be made before auth migration begins — this feeds directly into Contract 1, as QM will implement against it
- [ ] **Question Maker:** Complete OAuth migration; remove local auth endpoints
- [ ] **Question Maker:** Remove local `users` table; derive user from OAuth session
- [ ] **EduAI Core:** Verify Question Maker OAuth client working end-to-end
- [ ] **AI Tutor:** Audit current auth and document any edge cases found

### Weeks 5–6 (May 29–Jun 11): Course Data Centralization

- [ ] **EduAI Core:** Deploy centralized API v1 (role-filtered courses + enrollments endpoints)
- [ ] **Question Maker:** Update question/assessment FKs to use EduAI course IDs; remove local course/topic tables
- [ ] **AI Tutor:** Implement sync model decision from Phase 2
- [ ] **All:** Integration tests across auth + course data endpoints

### Weeks 7–8 (Jun 12–25): Integration Sprint

- [ ] All three extensions authenticated via EduAI Core
- [ ] Question Maker using EduAI Core for all user/course context
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

### How Question Maker Currently Calls EduAI Core

```javascript
// Question-Maker/app/backend/src/services/eduaiService.js
const eduaiApi = axios.create({
  baseURL: process.env.EDUAI_API_URL,
  headers: { 'x-api-key': process.env.EDUAI_API_KEY }  // admin key — not user-scoped
});
```

After auth migration, user-scoped requests should use the user's Bearer token forwarded from the session, not a shared admin API key.

### EduAI Core: Adding Role-Filtered Course Access

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
| `EduAICore/app/lib/auth/` | EduAI Core auth setup (OAuth provider) |
| `EduAICore/prisma/schema.prisma` | Database schema (CourseEnrollment, User, etc.) |
| `Question-Maker/app/backend/src/auth.js` | Current local JWT auth (to be replaced) |
| `Question-Maker/app/backend/src/services/eduaiService.js` | Current EduAI API client |
| `Question-Maker/app/backend/prisma/schema.prisma` | QM schema (users/courses tables to be removed) |

---

## 11. Known Challenges

### Local Development Setup

Running the full stack locally means running EduAI Core, AI Tutor, and Question Maker simultaneously — each with its own server process and database. This is more complex than the typical single-service setup most developers are used to.

**OAuth across localhost ports**  
The OIDC flow involves real browser redirects between services. Locally this means every service must be running on a known, fixed port, and CORS plus cookie domain settings must be explicitly configured for localhost. Session cookies in particular can behave differently when crossing ports (e.g., `localhost:5174` to `localhost:3000`) depending on the browser. This needs to be tested and documented for every developer's first setup.

**Multiple databases**  
Each service has its own PostgreSQL database. Local setup requires initializing all three databases and keeping their schemas in sync as migrations are added. A new developer joining mid-project needs to run three separate schema setups, not one.

**Environment variable coordination**  
Three separate repos each have `.env` files that need to reference each other. For example, `EDUAI_BASE_URL` in both AI Tutor and Question Maker must point to whatever port EduAI Core is running on locally. If a developer changes EduAI Core's port, they have to update env files in two other repos. This is easy to get wrong silently — a misconfigured URL produces auth failures that can look like code bugs.

**No shared local startup**  
Currently each service has its own Docker or npm run dev setup. There is no single command to start the whole stack. A shared `docker-compose.yml` at the monorepo root (or a simple shell script) would reduce friction significantly and is worth creating early.

### Integration Testing

Testing a cross-service flow — for example, a user logging into Question Maker via EduAI Core then generating a question — requires all three services running and correctly configured. This is harder to set up in CI than a single-service test.

**EduAI Core currently has no tests.** This is the most urgent blocker for the 
centralization work. Extensions are about to depend on Core's API surface, and without 
tests, a breaking change to any endpoint will have no automated signal — the failure only 
surfaces when someone manually tests the full stack together. Writing contract tests for 
Contracts 1–4 must be the first task completed in Week 2, before any other integration 
work begins.

**This project follows a test-first approach.** Contract tests are a gate on extension 
integration work, not a parallel track. No extension team should write integration code 
against an endpoint until that endpoint's contract test exists and passes. This applies 
directly to work already in progress: `feature/enrollment-api` (EC-3) must have a passing 
contract test before AI Tutor or Question Maker write any code that calls it. The OAuth 
endpoints in PRs #48–#51 must be verified against Contract 1 before Question Maker begins 
its auth migration.


Testing OAuth flows is also harder to automate. Most approaches either bypass the full flow in test mode (e.g., a test-only endpoint that issues a session directly) or run a real OAuth server in the test environment. The team should agree on which approach to use before writing auth-dependent tests.

### API Contract Drift

As EduAI Core's API evolves, extension teams must be notified of breaking changes. A change to a response shape or a renamed field in EduAI Core can silently break AI Tutor or Question Maker — and the failure may not show up until someone tests the integration manually. The contract test suites from Week 1 are the main defense here, but only if they are treated as a shared responsibility and updated whenever EduAI Core's API changes.

---

## 12. Considerations

### Monorepo

Right now EduAI Core, AI Tutor, and Question Maker live in three separate repositories. It is worth asking whether they should be consolidated into a single monorepo — one repository containing all three services as separate packages or workspaces.

This is not a decision that needs to be made today, but it is relevant enough to this epic that it should at least be raised. If the team is open to it, it could be elevated to a formal decision.

**What a monorepo would improve**

Several of the friction points described in section 11 are structural problems that a monorepo directly solves:

- A single `docker-compose.yml` at the root could start all three services with one command, eliminating the fragmented local dev setup.
- Shared TypeScript types and interfaces (e.g., the shape of a Course, User, or API response) could live in a shared package imported by all three services, removing the need to manually keep type definitions in sync across repos.
- Cross-service changes — for example, adding a new field to the `GET /api/courses` response and updating both AI Tutor and Question Maker to use it — could be done in a single pull request rather than three coordinated PRs across three repos.
- CI pipelines could run integration tests across the whole stack together, rather than per-service in isolation.
- The API contract definitions and stubs from Week 1 would have a natural home as a shared internal package.

**What a monorepo would not change**

A monorepo does not mean the services become a monolith. Each extension would still be a separately deployable application with its own server, database, and build process. The project plan's principle of separation is fully compatible with a monorepo — tools like npm workspaces, Turborepo, or nx are designed exactly for this pattern.

**The tradeoff**

The cost is the upfront migration: moving three repos into one, setting up a workspace structure, and updating CI pipelines. Done mid-project during a summer with a hard September deadline, that migration carries real risk if it takes longer than expected or breaks existing workflows.

One middle-ground option is to not migrate the existing repos but create a lightweight root-level `docker-compose.yml` and a shared package for API types — capturing most of the day-to-day benefit without a full repo restructure.
