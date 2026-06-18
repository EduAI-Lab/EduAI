# Changelog

All notable changes across the EduAI monorepo (AI Tutor, Question Maker, EduAI) are documented in this file.

> See [How to use this changelog](#how-to-use-this-changelog) at the bottom for entry format, categories, and the sprint template.


## [Week 7 — June 15–21, 2026]

### Added

- [question-maker] api: Auto-import taught Core courses on instructor login — `importTaughtCoursesFromCore` links or creates local courses for scoped Core offerings where the caller's enrollment role is `INSTRUCTOR` or `TA`, syncs topics, and seeds a Practice Exam. (#578, @GlowyBlack, 2026-06-15)
- [core] api: Expose `callerEnrollmentRole` on each course in `GET /api/courses` so extensions can distinguish teaching vs student enrollments when auto-importing. (#578, @GlowyBlack, 2026-06-15)
- [question-maker] tests: Add `topicSyncService.test.js`, `courseCodeUtils.test.js`, and `importTaughtCoursesService.test.js`; extend `coreApiService.test.js` for cookie-only scoped reads (no service-key fallback on 403). (#578, @GlowyBlack, 2026-06-15)

### Changed

- [core] refactor: Create `@eduai/types` shared workspace package — move `UserRole` and `EnrollmentRole` to `packages/types`; Core, AI Tutor, and QM now import from `@eduai/types` instead of maintaining independent copies, eliminating the need for manual sync across apps. (#594, #649, @evanbones, 2026-06-16)
- [question-maker] refactor: Extract shared `courseCodeUtils.js`, `topicSyncService.js`, and `coreCourseLinkService.js` — dedupe `syncTopicsFromCoreForCourse` / `normalizeCourseCode` from routes and import service; batch topic upserts with two `findAll` queries on the hot `/topics` path. (#578, @GlowyBlack, 2026-06-15)
- [question-maker] ui: Reuse `normalizeCourseCode` from `courseDisplay.ts` in `ProfileCoursesDialog` and `AddQuestionDialog`. (#578, @GlowyBlack, 2026-06-15)
- [question-maker] api: Use `cookieOnly` on user-scoped Core reads (`listCoursesFromCore`, topics) so a stale session does not fall back to the unscoped service key; prefer service key for enrollment roster reads used by RBAC. (#578, @GlowyBlack, 2026-06-15)
- [ai-tutor] api: Filter auto-import to Core courses where `callerEnrollmentRole` is `INSTRUCTOR` or `TA`. (#578, @GlowyBlack, 2026-06-15)

### Fixed

- [question-maker] security: Forward session cookie on `GET /api/eduai/courses/:courseId/topics` so Core applies enrollment scope. (#578, @GlowyBlack, 2026-06-15)
- [question-maker] security: Remove full-catalog service-key fallback from `findScopedCoreCourseByCode` — scoped cookie list only. (#578, @GlowyBlack, 2026-06-15)
- [question-maker] ui: Roll back locally created course when `link-core` fails after create (`ProfileCoursesDialog`). (#578, @GlowyBlack, 2026-06-15)
- [ai-tutor] fix: Restrict enrollment sync deletes to `STUDENT` rows so TA access is not revoked when Core returns a STUDENT-only roster. (#578, @GlowyBlack, 2026-06-15)
- [core] security: Block student-number reassignment via `POST /api/canvas/link-roster` after first link (409; contact admin to change). (#578, @GlowyBlack, 2026-06-15)
- [ai-tutor] fix: Add `updated` to `syncCourseEnrollments` client return type in `api.ts`. (#578, @GlowyBlack, 2026-06-15)
- [ai-tutor] tests: Extend `enrollmentSync.test.js` — TA rows survive STUDENT-only sync deletes. (#578, @GlowyBlack, 2026-06-15)
- [core] tests: Update `canvas.integration.test.ts` reassignment case to use a unique student number (avoids `studentIdLookup` collision with seeded data). (#578, @GlowyBlack, 2026-06-15)
- [core] fix: Stop frontend from retransmitting the full conversation history on every chat request by sending only the newest user message and associated metadata. (#487, @YibingW, 2026-06-15)

---

## [Week 6 — June 8–14, 2026]

### Added

- [core] feat: Add Settings Accessibility tab — Assistive Mode (`useAssistiveUi`), reduce motion, density (comfortable/compact), and theme (system/light/dark) with account persistence via `UiPreferencesProvider` and html hooks that stay absent at baseline. (#530, #560, @ebabar5, 2026-06-11)
- [core] tests: Unit tests for Settings Accessibility tab, `UiPreferencesProvider`, and extended `/api/preferences` UI fields. (#530, #560, @ebabar5, 2026-06-11)
- [question-maker] api: Scope `GET /api/eduai/courses` to the caller's Core enrollments via forwarded session cookie; guard `PATCH /api/course/:id/link-core` with `isCoreCourseInScopedList`; auto-link local courses by code and pull topics from Core. (#582, @GlowyBlack, 2026-06-13)
- [question-maker] ui: Filter course nav to Core-linked and sandbox courses when the instructor has Core enrollments (`useDisplayCourses`, `courseDisplay.ts`). (#582, @GlowyBlack, 2026-06-13)
- [ai-tutor] api: Scope `GET /api/eduai/courses` and `POST /api/courses/import-external` to instructor Core enrollments; add `POST /api/courses/:courseId/sync-enrollments` to pull active STUDENT rows from Core. (#582, @GlowyBlack, 2026-06-13)
- [ai-tutor] ui: Add “Sync students from Core” on the instructor course page for EduAI-imported offerings. (#582, @GlowyBlack, 2026-06-13)
- [core] db: Seed encrypted student numbers (`student_1`–`student_5`) on test student accounts so Canvas roster link works out of the box in dev. (#582, @GlowyBlack, 2026-06-13)
- [question-maker] tests: Extend `coreApiService.test.js` and `coreWiringDb.integration.test.js` for scoped Core course listing, link-core authorization, and variant testable 404 guard (#578). (#582, @GlowyBlack, 2026-06-13)
- [ai-tutor] tests: Add `#578` coverage in `courses.test.js` (scoped import, sync-enrollments) and `enrollmentSync.test.js` (STUDENT-only filter). (#582, @GlowyBlack, 2026-06-13)
- [core] rag: Add per-course RAG tuning — `ragTopK Int?` and `ragSimilarityThreshold Float?` on the `Course` model (nullable, both default to global values when null); `findRelevantContent` now fetches course settings and applies them with the resolution order: course override → caller arg → global env default. Two courses can now have completely different retrieval behaviour without touching the global config. (#365, @ammaarm128, 2026-06-05)
- [core] api: `GET /api/courses/:id/rag-settings` + `PATCH /api/courses/:id/rag-settings` — read and update per-course RAG overrides; PATCH is restricted to ADMIN/INSTRUCTOR; setting a field to `null` restores the global default. (#365, @ammaarm128, 2026-06-05)
- [core] ui: RAG Settings tab on the course detail page (`/courses/:courseId`) — visible to admins and instructors; form fields for Top-K chunks (1–20) and similarity threshold (0–1); empty fields clear the override back to global default. (#365, @ammaarm128, 2026-06-05)
- [core] tests: 10 unit tests (`embedding.rag-settings.test.ts`) for `findRelevantContent` course-level settings — covers ragTopK priority over caller limit, fallback to caller limit, fallback to global default, null course row, ragSimilarityThreshold priority, caller threshold fallback, `RAG_SIMILARITY_THRESHOLD` env var reading, correct `findUnique` call shape, and output mapping. (#365, @ammaarm128, 2026-06-05)
- [core] feat: Admin invitation flow — admins invite ADMIN / UNIT_ADMIN / INSTRUCTOR users via a hashed one-time email link that sets a password and signs the invitee in with the invited role, with an admin revoke/resend UI (token rotation) and an SMTP mailer that falls back to console logging when unconfigured. (#505, #561, @abdullahmoh21, 2026-06-11)
- [core] tests: Unit tests for invitation token hashing and create/accept schemas, plus integration coverage of the invitation lifecycle (create, supersede, revoke/resend rotation, accept, expiry, squatted-email 409, promote-failure rollback). (#505, #561, @abdullahmoh21, 2026-06-11)
- [ai-tutor] feat: TA route assignments across content GET, submissions, materials, and chats — add `role` field to `CourseEnrollment` (migration + Prisma schema), update `enrollmentSync` to persist and update enrollment role from Core, extend module/lesson/activity GET handlers with `hasElevatedAccess = isInstructor || isTa` so TAs bypass the publish gate, add `GET /activities/:activityId/submissions` and `GET /activities/:activityId/feedback` routes (INSTRUCTOR+TA only), and verify that chat metrics and per-student analytics remain INSTRUCTOR-only (§10, §15 of RBAC matrix). (#TBD, @evanbones, 2026-06-09)
- [ai-tutor] tests: Unit tests for enrollment role create/update/default paths in `enrollmentSync`; integration tests for TA admission on all newly-granted GET routes and TA rejection on mutation routes and cross-course scoping (TA in course A cannot access course B as TA). (#TBD, @evanbones, 2026-06-09)
- [ai-tutor] feat: UNIT_ADMIN wiring across content and admin routes — add `department String?` to `CourseOffering` (migration), `isUnitAdminForCourse(user, course)` helper (D-scoped: `course.department in user.authorizedUnits`, null department never matches), extend module/lesson/activity GET and mutation handlers to admit UNIT_ADMIN alongside INSTRUCTOR, add enrollment-admin scoping (`GET/POST/DELETE /admin/courses/:id/enrollments` now accept ADMIN, UNIT_ADMIN(D), INSTRUCTOR(C)), new `PATCH /admin/courses/:courseId/enrollments/:userId/role` for TA assign/remove, and app-level fence blocking UNIT_ADMIN from `/admin/settings*` and `/admin/users*`; frontend: route UNIT_ADMIN to `/instructor` in `home.tsx`, extend `requireClientUser` to accept role arrays, update all instructor route loaders to admit `['INSTRUCTOR', 'UNIT_ADMIN']`, and restrict `unsupported-role.tsx` to TA only. (#TBD, @evanbones, 2026-06-11)
- [ai-tutor] tests: Unit tests for `isUnitAdminForCourse` (null course, null dept, wrong dept, non-array authorizedUnits); integration tests for UNIT_ADMIN admission/rejection on module routes (issue #307 main case: create module on COSC course → 201, MATH course → 403), UNIT_ADMIN enrollment management (list/enroll/remove/TA-assign on department-scoped courses); fix sync-enrollment test expectations to include `updated` field. (#TBD, @evanbones, 2026-06-10)
- [ai-tutor] feat: Enrollment + publish gate on answer-submit and AI tutoring routes (§308) — restrict `POST /questions/:id/answer`, `POST /activities/:id/teach|guide|custom` to enrolled STUDENTs only (INSTRUCTOR/TA now receive 403); add publish-chain gate checking courseOffering, module, and lesson `isPublished` before accepting submissions or AI requests; remove now-redundant instructor self-test path from answer handler. (#TBD, @evanbones, 2026-06-10)
- [ai-tutor] tests: Role-rejection tests for answer and AI routes (INSTRUCTOR → 403, TA → 403, unenrolled STUDENT → 403); publish-chain gate tests (unpublished lesson, module, course each → 403); update tutoring-flow integration tests to use enrolled STUDENT instead of INSTRUCTOR (previously passing by accident). (#TBD, @evanbones, 2026-06-10)
- [ai-tutor] feat: Missing content routes and bug-report admission (#309) — `DELETE /modules/:id` and `DELETE /lessons/:id` (cascade; INSTRUCTOR(C)/UNIT_ADMIN(D)/ADMIN), `PATCH /lessons/:id` (edit title/contentMd/position; same roles), and open bug-report submission to all authenticated roles by replacing `requireRoles(['STUDENT','INSTRUCTOR'])` with a bare auth check; relax the app-level admin isolation fence so ADMIN can reach module/lesson write endpoints and `/bug-reports`. (#TBD, @evanbones, 2026-06-10)
- [ai-tutor] tests: Role tests for DELETE module (INSTRUCTOR ✓ cascades to lessons, TA ✗, non-instructor ✗, ADMIN ✓), DELETE lesson (same role matrix), PATCH lesson (title/contentMd/position updates, 400 on empty body, 403 for TA); update bug-report tests: ADMIN now receives 201, add TA → 201 test. (#TBD, @evanbones, 2026-06-10)
- [ai-tutor] feat: Instructor analytics endpoints (#310) — `GET /courses/:id/submissions` (ADMIN/UNIT_ADMIN(D)/INSTRUCTOR(C)/TA(C), filterable by activityId/studentId, paginated), `GET /courses/:id/student-metrics` (ADMIN/UNIT_ADMIN(D)/INSTRUCTOR(C) only, aggregates ActivityStudentMetric per student), `GET /courses/:id/analytics` (same roles, per-activity ActivityAnalytics rows); own-resource fallback `GET /me/submissions` and `GET /me/feedback` with no enrollment check so inactive students can always read their own past data (§10/§19). (#TBD, @evanbones, 2026-06-10)
- [ai-tutor] tests: Integration tests with 3 enrolled students and 2 activities — INSTRUCTOR sees all submissions (200), TA sees submissions (200) but is blocked from student-metrics/analytics (403), ADMIN admitted to all three endpoints, UNIT_ADMIN(D) admitted when department matches; own-resource tests verify inactive-enrollment students still retrieve their submissions and feedback (§19 own-resource rule). (#TBD, @evanbones, 2026-06-10)
- [core] feat: Chat latency sprint (#203) — auto-RAG on the tool path when a course is selected (#207), admin `webToolsEnabled` toggle default OFF (#348), admin Supports Tools confirmation + tooltips for all CHAT models (#264), and `needsCourseRag()` intent helper; extract `chat-tools.ts` / `chat-intent.ts` / `web-tool-ui.ts` and add `forceHybridRag` bench override. Per-turn tier routing (#334) removed from scope. ([#529](https://github.com/EduAI-Lab/EduAI/pull/529), @superbolt08, 2026-06-09)
- [core] feat: Add account-level Assistive Mode shell — `AssistiveUiProvider` syncs `data-assistive` on `<html>` (SSR + client), `GET`/`PATCH /api/preferences` for `UserPreference.assistDefault`, and the `/chat` assist toggle writes through the provider so the preference persists platform-wide. Settings Accessibility tab deferred to #530 (blocked on #491). (#520, #531, @ebabar5, 2026-06-09)
- [core] ui: Add active-element highlighting + focus mode gated by `[data-assistive]` — emphasize the latest assistant message (outline + background), de-emphasize older thread content (opacity, restored on hover/focus), anchor the chat composer, stronger `:focus-visible` rings, auto-focus input after each assistant turn, optional focus mode (hide sidebar + course/model chrome), and client `re_orientation` telemetry for U6/U7 latency. (#525, #555, @ebabar5, 2026-06-10)
- [core] tests: Unit tests for `resolveMessageHighlightRole`, `assistive-active-highlight.css` contract (scoped under `[data-assistive]`, WCAG non-color-only cues, focus-mode chrome hiding), `postAssistiveClientEvent`, and chat header/message highlight class wiring. (#525, #555, @ebabar5, 2026-06-10)
- [core] db: Add Canvas roster sync schema — optional unique `User.studentId` (UBC student number) and `CanvasRosterMember` staging table (`canvas_roster_members`) keyed by course + Canvas user id; migration `20260608200000_canvas_roster_sync_schema`. (#511, @GlowyBlack, 2026-06-10)
- [core] db: Encrypt `CanvasRosterMember.sisUserId` at rest and add `sisUserIdLookup` HMAC for roster-to-user matching; migration `20260611120000_roster_sis_user_id_lookup`. (#511, @GlowyBlack, 2026-06-10)
- [core] api: Add Canvas course sync backend — `GET /api/canvas/courses` (instructor picker with `isSynced` state), `POST /api/canvas/sync` (selective sync/unsync from checked Canvas course ids: upsert Core `Course`, instructor `Enrollment`, roster staging, and student `Enrollment` when `sis_user_id` matches `User.studentId`), and `POST /api/canvas/link-roster` (STUDENT/TA links account by student number); extend catch-all `canvas.$.ts` routing. (#511, @GlowyBlack, 2026-06-10)
- [core] ui: Add Canvas dashboard sync card and course picker dialog — instructors select Canvas courses to sync/unsync from the dashboard; shows roster staging counts and sync errors; sync removed from settings (connect-only there). (#511, @GlowyBlack, 2026-06-10)
- [core] ui: Add post-signup student-ID onboarding — `/onboarding/student-id` prompts STUDENT/TA users to link their Canvas student number via `POST /api/canvas/link-roster` or skip; dashboard redirects until linked or skipped. (#511, @GlowyBlack, 2026-06-10)
- [core] tests: Route-level tests for `POST /api/assistive-events` (`assistive-events.route.test.ts`, 8 cases) — auth (401), method (405), invalid JSON / schema / non-client event type (422), chat ownership (404), and sanitized create (201). (#521, #532, @Ayyhab, 2026-06-10)
- [core] tests: Add Canvas UI and onboarding unit tests (`CanvasCourseSyncDialog`, `CanvasDashboardCard`, `student-id-onboarding-form`, `canvas-onboarding`); extend `canvas-enrollment-link` and `canvas-student-id` for encrypted roster matching; integration test harness reuses dev Postgres host/port on Windows (`test-database-url.ts`). (#511, @GlowyBlack, 2026-06-10)
- [core] ui: Add assistive reading typography gated by `[data-assistive]` — `.reading-surface` on chat messages, markdown, reasoning, and course overview text; 16px base, 1.625 line-height, 65ch measure, increased letter/word and paragraph spacing (no font swap). (#523, #539, @ebabar5, 2026-06-10)
- [core] tests: Unit tests for `assistive-reading.css` contract and `.reading-surface` class on chat/markdown components. (#523, #539, @ebabar5, 2026-06-10)
- [core] tests: Unit tests for `/api/preferences` and `AssistiveUiProvider`; integration tests for assistive preference round-trip, per-account isolation, and guest 401 on PATCH. (#520, #531, @ebabar5, 2026-06-09)
- [core] feat: ADHD Assist telemetry (#521, #532) — `AssistiveEvent` Prisma model + migration (`assistive_events`) stores derived compliance metrics only (word count, `topSummary`, `nextLine`, `underCap`, `structuralPass`, model/tokens/duration); never message text (BREB-consistent). Shared `apps/core/app/lib/ai/adhd-metrics.ts` used by chat `onFinish` logging and `eval:adhd`. `POST /api/assistive-events` accepts sanitized client UI events (`mode_toggled`, `expand_click`, `task_initiation`, `re_orientation`, `session_completion`). Research report script at `eduai-summer-2026/reports/scripts/report-adhd-metrics.ts` (Cohen's d OFF vs ON; run from `apps/core`). (#521, #532, @Ayyhab, 2026-06-09)
- [core] tests: Unit tests for `computeAdhdResponseMetrics` / structural pass heuristics (`adhd-metrics.test.ts`, 4 cases) and assistive event persistence + client metric sanitization (`assistive-events.server.test.ts`, 3 cases). (#521, #532, @Ayyhab, 2026-06-09)
- [core] feat: ADHD Assist Phase 3 oversight (#493, #533) — `auditAndMaybeRewrite` audits Assist ON drafts; deterministic anchor fix preserves trailing redirect questions; LLM rewrite with draft fallback on provider failure; separate `oversightDurationMs` and oversight token fields in telemetry; overseen streaming replies persisted. Env: `ADHD_ASSIST_OVERSIGHT` (default on). Requires #532 telemetry. (#493, #533, @Ayyhab, 2026-06-09)
- [core] tests: Unit tests for Phase 3 oversight (`adhd-oversight.test.ts`) — env flag, S1-on deterministic fix, pass-through, LLM fallback, ineligible-draft preservation, over-cap LLM rejection. (#493, #533, @Ayyhab, 2026-06-09)
- [core] ui/css: ADHD UI platform hygiene pass — mount `Toaster`, add global `prefers-reduced-motion` support. (#543, @yta3216, 2026-06-09)
- [core] api: Add Canvas sync services — paginated Canvas REST client (`listTeacherCanvasCourses`, roster fetch), course field mapping, roster upsert/deactivate, enrollment linking from staging (`enrollment-link.server.ts`, `resolveCanvasEnrollmentsForUser`), sync delta (`computeCanvasSyncDelta`), instructor course-access validation, sync rate limit (1 per 30s), and link-roster rate limit (10 per 15 min). (#511, @GlowyBlack, 2026-06-08)
- [core] api: Wire admin `PATCH /api/users/:id` to accept `studentId` and trigger `resolveCanvasEnrollmentsForUser` when a student number is set. (#511, @GlowyBlack, 2026-06-08)
- [core] tests: Add Canvas sync test coverage — 8 unit files (`canvas-client`, `canvas-encryption`, `canvas-schemas`, `canvas-sync-services`, `canvas-sync-delta`, `canvas-enrollment-link`, `canvas-guards`, `canvas-link-roster`) and `canvas.integration.test.ts` (26 integration tests for connect, courses picker, sync/unsync, link-roster, auth guards, and rate limits); document in `TESTS.md`. (#511, @GlowyBlack, 2026-06-08)
- [core] api: Add TA management (`GET`/`POST`/`DELETE /api/courses/:courseId/tas`) and instructor reassignment (`PATCH /api/courses/:id`) for `ADMIN`/`UNIT_ADMIN`. (#491, @yta3216, 2026-06-08)
- [core] ui: Add Staff tab to Course Detail with `useCourseTAs` hook — lists current instructor and TAs with reassignment controls for admin/unit admin. (#491, @yta3216, 2026-06-08)
- [core] [ai-tutor] api: Move course publish state to Core as source of truth (#477) — new `PATCH /api/courses/:id/publish` and `/unpublish` endpoints on Core (service-key + session auth, rank ≥ 2); AI Tutor write-through calls Core before updating local DB; `coreOfferingId` set at import time and `isPublished` synced from Core; native courses skip the Core call; unpublish cascades to child modules and lessons. (#510, @evanbones, 2026-06-08)
- [all] tests: Backend E2E Playwright suite (#398) — 8 spec files covering Core, AI Tutor, and Question Maker: auth flows, RBAC enforcement (STUDENT-blocked routes, unauthenticated 401 gates, role-escalation prevention), cross-service session propagation and cascading logout, and two-user data isolation; QM RBAC — question/assessment routes blocked for STUDENT (403), course routes open to all; Core RBAC — admin-only routes, invitation management, bug-report ownership scope; AI Tutor RBAC — course/module mutation gates and admin route gates; fix AI Tutor import-external integration test (500→201) by switching `vi.restoreAllMocks()` to `vi.unstubAllGlobals()` in afterEach to preserve the setup.js console.error spy; fix QM variant ID collision in `coreWiring.integration.test.js` (403→404) by using variant id `0` (PostgreSQL SERIAL sequences start at 1, so 0 can never be auto-generated) and upgrading `truncateTestDatabase()` to reset ALL table sequences (not just `users`) so IDs never accumulate across test files. (#398, @evanbones, 2026-06-14)


### Changed

- [monorepo] docs: Document scoped extension course listing and AI Tutor enrollment sync in `docs/implementations/api-wiring.md`. (#578, @GlowyBlack, 2026-06-11)
- [question-maker] api: Prefer Core session cookie over service key in `coreApiService.fetchFromCore` for user-scoped Core calls; support string CUID topic ids in Add Question and topic sync. (#578, @GlowyBlack, 2026-06-11)
- [ai-tutor] infra: Default AI Tutor server `.env.example` and test env to `127.0.0.1` for Postgres on Windows. (#578, @GlowyBlack, 2026-06-11)
- [core] rag: Cap cloud `embedMany` batch size at the provider limit of 100 (was 128) so `EMBED_MANY_BATCH_SIZE` env overrides cannot exceed Gemini's "At most 100 requests per batch" ceiling; add unit tests verifying 250-chunk materials split correctly and preserve order. (#52, #504, @ebabar5, 2026-06-10)
- [core] ui: Wire course detail Enrollments tab to `GET /api/courses/:id/enrollments` via `useCourseEnrollments`; show enrolled users with name, email, student number, role, and active state. (#577, @GlowyBlack, 2026-06-12)
- [core] rag: Cap cloud `embedMany` batch size at the provider limit of 100 (was 128) so `EMBED_MANY_BATCH_SIZE` env overrides cannot exceed Gemini's "At most 100 requests per batch" ceiling; add unit tests verifying 250-chunk materials split correctly and preserve order. (#52, #504, @ebabar5, 2026-06-10)
- [core] api: Auto-publish Canvas-synced courses (`isPublished: true`) so linked students can list them under the student publish gate. (#511, @GlowyBlack, 2026-06-10)
- [core] refactor: `eval-adhd-assist.mjs` imports shared `adhd-metrics.ts` instead of duplicating compliance scoring; `eval:adhd` runs via `tsx`. (#521, #532, @Ayyhab, 2026-06-09)
- [core] fix: `report-adhd-metrics.ts` now reports the `task_initiation` / `re_orientation` / `session_completion` behavioural events alongside `response_compliance`, and renders `—` instead of `NaN` for empty cohorts or an under-powered Cohen's d (< 2 samples per side). (#521, #532, @Ayyhab, 2026-06-10)
- [core] fix: #264 / #348 review follow-ups — migration backfill clears `supportsTools` on non-CHAT and known small-model slugs; runtime `modelSupportsTools()` applies the same guard; chat UI reads `X-Web-Tools-Enabled` and hides web-tool labels when the admin toggle is OFF; admin Supports Tools shows a confirmation dialog (toggle remains visible for all CHAT models). ([#529](https://github.com/EduAI-Lab/EduAI/pull/529), @superbolt08, 2026-06-10)
- [monorepo] docs: Mark Question Maker §16–§18 as implemented in `rbac-matrix.md`. (#518, @abdullahmoh21, 2026-06-08)

### Fixed

- [core] fix: Remove the root document layout's route-data hook so development pages no longer crash with an invalid hook error before the router context is available. (#591, #592, @Whiteknight07, 2026-06-14)
- [core] fix: `re-embed-course` script resolves courses by code with `findFirst` since `code` alone is not unique. (#561, @abdullahmoh21, 2026-06-11)

### Fixed
- [core] fix: ADHD oversight edge cases from pre-PR review (#493, #533) — preserve ineligible draft text instead of empty responses; reject LLM rewrites that exceed word cap; persist all assistant tool-step messages with overseen text on the final turn; return overseen draft on post-audit persistence failures instead of 500. (#493, #533, @Ayyhab, 2026-06-09)

---

## [Week 6 — June 8–12, 2026]

### Added
- [core] rag: Extend semantic chunking with document-aware PDF/DOCX/PPTX section splits (Chapter/Section/Part, numbered headings, slide markers, all-caps titles) and ~80-char overlap on the upload path; `resolveMaterialChunks` separator round-trip preserved. Re-upload or re-embed existing materials to benefit. (#433, #563, @superbolt08, 2026-06-11)
- [core] ui/css: ADHD UI platform hygiene pass — mount `Toaster`, add global `prefers-reduced-motion` support. (#543, @yta3216, 2026-06-09)
- [core] api: Add TA management (`GET`/`POST`/`DELETE /api/courses/:courseId/tas`) and instructor reassignment (`PATCH /api/courses/:id`) for `ADMIN`/`UNIT_ADMIN`. (#491, @yta3216, 2026-06-08)
- [core] ui: Add Staff tab to Course Detail with `useCourseTAs` hook — lists current instructor and TAs with reassignment controls for admin/unit admin. (#491, @yta3216, 2026-06-08)
- [core] feat: Add account-level Assistive Mode shell — `AssistiveUiProvider` syncs `data-assistive` on `<html>` (SSR + client), `GET`/`PATCH /api/preferences` for `UserPreference.assistDefault`, and the `/chat` assist toggle writes through the provider so the preference persists platform-wide. Settings Accessibility tab deferred to #530 (blocked on #491). (#520, #531, @ebabar5, 2026-06-09)
- [core] ui: Add assistive reading typography gated by `[data-assistive]` — `.reading-surface` on chat messages, markdown, reasoning, and course overview text; 16px base, 1.625 line-height, 65ch measure, increased letter/word and paragraph spacing (no font swap). (#523, #539, @ebabar5, 2026-06-10)
- [core] tests: Unit tests for `/api/preferences` and `AssistiveUiProvider`; integration tests for assistive preference round-trip, per-account isolation, and guest 401 on PATCH. (#520, #531, @ebabar5, 2026-06-09)
- [core] tests: Unit tests for `assistive-reading.css` contract and `.reading-surface` class on chat/markdown components. (#523, #539, @ebabar5, 2026-06-10)
- [question-maker] api: Enforce the §16–§18 RBAC matrices — session-role gates, per-course access middleware, `createdBy` TA own-only authoring, instructor-only approval/assessments, owner-keyed Canvas mappings, and ADMIN-only bug-report triage. (#518, @abdullahmoh21, 2026-06-08)
- [question-maker] tests: Add RBAC coverage — `courseAccess` unit tests plus role×route matrix tests across questions, variants, assessments, and Canvas. (#518, @abdullahmoh21, 2026-06-08)

### Fixed

- [core] fix: ADHD oversight review feedback (#493, #533) — document explicit 20-word clarification user-turn threshold (policy §3 heuristic); match last inline `Next?` anchor; promote only forward continuation offers, not comprehension-check questions. (#493, #533, @Ayyhab, 2026-06-13)
- [core] fix: ADHD oversight adversarial tests and inline Next? guard (#493, #533) — reject `Next?`-prefixed comprehension checks in deterministic anchor promotion; extract `buildOverseenAssistantMessagesToPersist` for shared streaming/non-streaming persistence; add adversarial unit tests and `chat-oversight.route.test.ts` route coverage for save-first-then-show and persistence-failure 500 paths. (#493, #533, @Ayyhab, 2026-06-13)
- [core] fix: ADHD oversight edge cases from pre-PR review (#493, #533) — preserve ineligible draft text instead of empty responses; reject LLM rewrites that exceed word cap; persist all assistant tool-step messages with overseen text on the final turn; return 500 on oversight/persistence failures instead of unsaved fallback replies. (#493, #533, @Ayyhab, 2026-06-12)
- [core] api: Allow students/TAs to link a student number via `POST /api/canvas/link-roster` before any instructor has synced Canvas; enrollments resolve automatically after sync. (#577, @GlowyBlack, 2026-06-12)
- [core] ui: Remove skip-onboarding for student ID — student number is required for STUDENT/TA accounts. (#577, @GlowyBlack, 2026-06-12)
- [core] chat: Wire Assistive Mode toggle in chat to `AssistiveUiProvider` so the switch immediately updates `data-assistive` on `<html>` and persists via the provider (single write — no double-persist); also persist `lastCourseCode` on course selection change. (#546, @yta3216, 2026-06-10)
- [core] ui: Wayfinding — replace `<a href>` with SPA `<Link>` in nav, add route-aware active state with `aria-current="page"`, derive page titles from pathname when no explicit title prop is passed, and wire breadcrumb navigation (Home > Courses > [name], Home > Admin > [page]) on courses and admin routes. (#522, @yta3216, 2026-06-10)
- [core] tests: Add `ChatViews`, `NavMain`, and `SiteHeader` unit tests — assistive toggle callback, nav active state per pathname, child-route activation, route-derived titles, and breadcrumbs-replace-h1 behaviour. (#519, #522, #546, @yta3216, 2026-06-10)
- [core] api: Fix roster enrollment linking after `sisUserId` encryption — decrypt roster values in `linkEnrollmentsFromStagingForCourse` so re-sync reactivates student enrollments; backfill missing `studentIdLookup` before resolving enrollments. (#511, @GlowyBlack, 2026-06-10)
- [core] api: Harden roster sync upserts (`lastSeenAt` per row, clearer Prisma schema errors) so `canvas_roster_members` populate reliably after migration. (#511, @GlowyBlack, 2026-06-10)
- [core] tests: Point integration tests at `eduai_test` on the same Postgres instance as local dev (reuse `apps/core/.env` host/port); document Windows workflow in `docs/implementations/windows-dev-database.md`. (#511, @GlowyBlack, 2026-06-10)
- [core] nav/css: Remove dead nav controls (Quick Create, Inbox, stub menu items); fix Outfit/Inter font mismatch; restore visible scrollbars at WCAG 2.5.8-compliant 12px width. (#543, @yta3216, 2026-06-09)
- [core] fix: Fix instructors and TAs not seeing assigned courses, admins unable to upload materials, instructors unable to add topics, and the same material being blocked from upload to two different courses. (#491, @yta3216, 2026-06-08)
- [core] fix: Fix admin user management showing `NaN` for course count and unit admin unable to reassign instructors/TAs to courses. (#491, @yta3216, 2026-06-08)
- [core] api: Validate Canvas URL with `parseAndValidateCanvasUrl` before saving integration credentials so non-local HTTP hosts are rejected even when credential verification is mocked in tests. (#511, @GlowyBlack, 2026-06-08)

---

## [Week 5 — June 2–6, 2026]

### Added

- [core] feat: Add RBAC platform UI layer — permissions matrix, access resolver, nav helpers, role-gated course list/detail components, and course API hooks for courses, materials, topics, and enrollments. (#491, @yta3216, 2026-06-03)
- [core] feat: Add `UNIT_ADMIN` role — schema migration, unit-scoped view, seed personas, `authorizedUnits` in auth session, `isPublished` on Course schema, departments enum, and `UNIT_ADMIN` support in user management UI and API. (#491, @yta3216, 2026-06-03)
- [core] ui: Add publish toggle, department dropdown, and `authorizedUnits` DB fetch to course views; improve course code UX with department prefix. (#491, @yta3216, 2026-06-03)
- [core] feat: Add course delete with confirmation modal, `DELETE /api/courses/:id`, and `UNIT_ADMIN` delete permission scoped to authorized units. (#491, @yta3216, 2026-06-04)
- [core] ui: Person B RBAC platform UI — role-aware components, hooks, and tests. (#491, @ebabar5, 2026-06-03)
- [core] feat: vLLM local inference provider — OpenAI-compatible `vllm` provider on cmps01 (`VLLM_BASE_URL`, port **8001**), `mergeLocalInferenceFromEnv()`, Admin-registered models (provider seeded, same pattern as Ollama), `npm run vllm:smoke`, and `providers.server.ts` split for Vite client/server boundary. Stress-tested on dev: **~15× faster** than Ollama under 5-way parallel load; warm direct **~57 ms**, 10 parallel **~320–380 ms**, EduAI full stack median **~211 ms**. Docs: [`docs/rag-ai/VLLM.md`](docs/rag-ai/VLLM.md). ([#449](https://github.com/EduAI-Lab/EduAI/pull/449), Closes #435, #394)
- [core] feat: Local Ollama embedding provider for RAG — `EMBEDDING_PROVIDER=local` routes index and query embeds through Ollama (`mxbai-embed-large`, 1024-dim); fails fast when Ollama is unavailable (no silent cloud fallback); dimension validation and `[embedding]` provider logging in `embedding.ts`. (#361, #370, #441)
- [core] docs: LOCAL-EMBEDDINGS decision — `vector(1024)` migration, default local model, re-embed strategy in [`docs/rag-ai/LOCAL-EMBEDDINGS.md`](docs/rag-ai/LOCAL-EMBEDDINGS.md). (#369)
- [core] tooling: `npm run re-embed:course -- <courseId>` and `reEmbedCourseMaterials()` to re-index course materials after provider/dimension changes. (#373)
- [core] tests: Unit tests for `getExpectedEmbeddingDimension` and `wantsLocalEmbeddingProvider` in `embedding.test.ts`. (#361)
- [core] feat: Per-course embedding settings and re-index UI — `Course` embedding fields, `GET/PATCH /api/courses/:courseId/embedding-settings`, async `POST /api/courses/:courseId/re-embed` + `GET .../re-embed/:jobId` with progress polling, Materials tab controls, and `embedding-config.test.ts`. (#373, #441)
- [core] feat: Background `CourseReEmbedJob` for re-index — non-blocking HTTP, per-material progress, partial-failure handling; `re-embed-job.test.ts`. (#441)
- [core] api: Add ADMIN-only bug-report list/triage endpoints with anonymity masking, plus `GET /api/bug-reports?mine=true` for own reports (§11). (#304, #478, @abdullahmoh21, 2026-06-05)
- [core] auth: Make `GET /api/ai-providers` and `GET /api/ai-models` ADMIN-only (§13). (#303, #478, @abdullahmoh21, 2026-06-05)
- [core] api: Add `GET`/`PATCH /api/me`, block self-role-changes, and support `authorizedUnits` assignment for UNIT_ADMINs (§4). (#297, #478, @abdullahmoh21, 2026-06-05)
- [core] api: Gate course-context AI chat by course access and add owner-only `DELETE /api/chats/:chatId` (§10, partial — chat-metrics deferred pending chat↔course modeling). (#302, #478, @abdullahmoh21, 2026-06-05)
- [core] api: Enforce course-scoped RBAC and student answer-key stripping on the questions endpoints (§9). (#301, #478, @abdullahmoh21, 2026-06-05)
- [core] api: Enforce the §7 course-materials RBAC matrix and add `DELETE /api/courses/:id/materials/:materialId`. (#300, #478, @abdullahmoh21, 2026-06-05)
- [core] api: Add enrollment create/update/remove endpoints with a transactional instructor-floor invariant (§6). (#305, #478, @abdullahmoh21, 2026-06-05)
- [core] api: Enforce the §8 course-topics RBAC matrix and add a `PATCH` topic rename route. (#299, #478, @abdullahmoh21, 2026-06-05)
- [core] api: Enforce the §5 course-management RBAC matrix, including per-role course list scoping and a new soft-delete `DELETE /api/courses/:id`. (#298, #478, @abdullahmoh21, 2026-06-05)
- [core] db: Add `CourseMaterial.uploadedBy` and `CourseTopic.createdBy` owner columns for TA own-only RBAC. (#294, #478, @abdullahmoh21, 2026-06-05)
- [core] auth: Add the RBAC keystone helpers (`resolveCourseAccess`, course-list filtering, answer stripping, `DepartmentSchema`) and document the shared §3 contract in `rbac-matrix.md`. (#293, #478, @abdullahmoh21, 2026-06-05)
- [core] tests: Add 41 unit tests and shared test fixtures for the RBAC keystone helpers. (#293, #478, @abdullahmoh21, 2026-06-05)
- [core] feat: Persist Assistive mode + selected course per user across page refreshes and new chats. New `UserPreference` table (`assistDefault`, `lastCourseCode`) + migration `add_user_preferences`; the `/chat` loader seeds the toggle + course from the user's stored preference, a `/chat` route `action` upserts on change via `useFetcher`, and `POST /auth/logout` clears the row so the next login starts fresh. A restored course the user can no longer access falls back to none; per-chat `Chat.adhdAssist` still wins when opening an existing chat. New `apps/core/app/lib/user-preferences.ts` (pure parse/resolve helpers) and `user-preferences.server.ts` (centralized `prisma.userPreference` access). (#420, @Ayyhab, 2026-06-02)
- [core] tests: Unit tests for `parsePreferenceUpdates`, `resolveSelectedCourse`, and the preference persistence service (`get`/`save`/`clear`) at `apps/core/app/tests/unit/user-preferences.test.ts` and `user-preferences.server.test.ts` — 16 cases mapped to the #420 acceptance criteria; pinned to the node test environment. (#420, @Ayyhab, 2026-06-02)
- [core] api: Implement Canvas API key storage for instructors (#381) — `canvas_integrations` table with AES-256-GCM encrypted tokens; `GET /api/canvas/integration`, `POST /api/canvas/connect` (probes `users/self/profile` before save), `DELETE /api/canvas/disconnect`; session auth for `INSTRUCTOR`/`ADMIN`; unit + integration tests.(2026-06-05)
- [monorepo] docs: Add Canvas integration strategy report — CWL-first access, Canvas REST roster sync MVP (course users + profile `primary_email` fallback), Question Maker REST for quizzes; LTI 1.3 documented as deferred until in-Canvas launch is required; local API validation notes and UBC pilot checklist. Added Canvas LTI vs API key technical research — endpoint reference, PowerShell/`curl.exe` testing notes, pros/cons, implementation checklist; links to `docs/implementations/lti-canvas-integration-report.md`. Add Canvas API integration guide — WSL + Canvas LMS `docker_dev_setup.sh`, `docker-compose.override.yml` host port mapping (e.g. `8080:80` to avoid Core on 3000), Question Maker connect/API verification, Docker vs host dev, troubleshooting. (#447, @glowyblack, 2026-06-03)
- [core] ui: Add presentational skeleton for all 32 EduAI Core domain components — exported `*Props` types, route-owned I/O for materials upload, course selector, API key settings, and Ollama model fetch; 29 Vitest + RTL component tests under `apps/core/app/tests/unit/`. (#437, #438, #385, @ebabar5 @yta3216 @Ayyhab, 2026-06-03)
- [core] ui: Add empty-state rows to admin AI models and providers tables (`No models found.`, `No providers found.`). (#438, @yta3216, 2026-06-03)
- [core] api: Build `GET /api/courses/:id/enrollments` — dual-auth endpoint (user OAuth Bearer and service key) that returns all enrollments (active and inactive) for a course; maps Prisma `Enrollment` + `User` join to the contract shape (`studentId`, `studentEmail`, `studentName`, `enrolledAt`, `isActive`, `role`); service key callers skip enrollment authorization; user OAuth callers must be enrolled in the course (else `403`); returns `404 COURSE_NOT_FOUND` for missing/soft-deleted courses. Unblocks AI Tutor's `POST /api/courses/import-external` flow. (#430, @ammaarm128, 2026-05-30)
- [core] tests: Add 14 unit tests (`courses.enrollments.test.ts`) for `GET /api/courses/:id/enrollments` — covers `400` missing ID, `401` no session, `403` invalid service key, `403` user not enrolled, `404` course not found (both auth paths), `200` via service key and user OAuth (STUDENT + INSTRUCTOR), role mapping for STUDENT/TA/INSTRUCTOR, null `enrolledAt` handling, active + inactive returned together, and empty enrollment list. (#430, @ammaarm128, 2026-05-30)
- [core] tests: Add integration tests (`courses.enrollments.integration.test.ts`) for `GET /api/courses/:id/enrollments` — seeds users (STUDENT, TA, INSTRUCTOR, outsider) and enrollments against a real test DB; covers `401`, `403` invalid key, `403` not enrolled, `404` nonexistent course, `200` via service key and user OAuth, role mapping, active + inactive returned, and correct field values from seeded data. (#430, @ammaarm128, 2026-05-30)
- [core] api: Build the Core questions endpoints — `POST /api/questions` (validated create with idempotency-key dedupe), `GET /api/questions` (list/filter), `GET /api/questions/:id`, and `PATCH /api/questions/:id` (testable toggle); hardens topic resolution and idempotency handling. Closes #280. (#430, @abdullahmoh21, 2026-06-01)
- [question-maker] api: Wire Question Maker to Core — `PATCH /api/course/:id/link-core` (course linking), `POST /api/course/:id/sync-topics` (topic pull/push), question/variant push to Core on approval, and `PATCH /api/questions/variants/:variantId/testable` toggle, all authenticated with the Core service key; add `coreApiService` and `coreWiringService`. Closes #282. (#430, @abdullahmoh21, 2026-06-01)
- [ai-tutor] api: Wire enrollment sync and testable-question fetch to Core via the service key — `syncCourseEnrollments` pulls Core enrollments into AI Tutor and `listCourseTestableQuestions` fetches a course's testable questions from Core. (#430, @abdullahmoh21, 2026-06-01)
- [ai-tutor] feat: Inject testable Core questions into the supervisor's hidden context for teach/guide/custom tutoring modes so the tutor can steer toward assessed material. (#430, @abdullahmoh21, 2026-06-01)
- [core] auth: Seed Better Auth credential passwords for dev accounts so seeded users can sign in locally with email/password. (#430, @abdullahmoh21, 2026-06-01)
- [monorepo] infra: Add `test:coverage` tooling — root `npm run test:coverage` runs V8 coverage across `edu-ai`, `ai-tutor-server`, and `question-maker-backend` via Turborepo; add per-app `test:coverage` scripts (core, ai-tutor, ai-tutor server, QM backend, QM frontend); gitignore generated coverage report directories. (#430, @abdullahmoh21, 2026-06-01)
- [core] tests: Add unit + integration coverage for the questions endpoints (`questions.server.test.ts`, `questions.integration.test.ts`) and the materials loader (`courses.materials.test.ts`); expand course handler tests for `getCourses`/`createCourse`/`updateCourse` and the INSTRUCTOR role; assert `Prisma.DbNull` for null bug-report context. (#430, @abdullahmoh21, 2026-06-01)
- [ai-tutor] tests: Add unit tests for enrollment sync (`enrollmentSync.test.js`), the testable-questions client (`eduaiClient.testableQuestions.test.js`), and EduAI response schemas (`eduai.schemas.test.js`); assert logout proxies through the backend `/api/logout`. (#430, @abdullahmoh21, 2026-06-01)
- [question-maker] tests: Add unit + integration coverage for Core wiring (`coreWiringService.test.js`, `coreApiService.test.js`, `coreWiring.integration.test.js`, `coreWiringDb.integration.test.js`, `syncTopicsCounter.integration.test.js`, `variantApproval.integration.test.js`), variant utils / bank generation / error handler (`assessmentVariantUtils.test.js`, `generateBankVariants.test.js`, `errorHandler.test.js`), assessment service gaps (`assessmentServiceGaps.integration.test.js`, `assessmentVariantService.integration.test.js`), AI generation (`eduaiService.test.js`, `aiServiceGenerate.test.js`), canvas converters (`canvasServiceConvert.test.js`), assessment sections (`assessmentSectionService.integration.test.js`), Canvas import/export (`canvasImportExport.integration.test.js`), and extracted-question saving (`saveExtractedQuestions.integration.test.js`); point QM backend `test:coverage` at a dedicated `vitest.coverage.config.js` that runs the unit and integration suites together over `src/**`, with a `globalSetup` that syncs the test-DB schema once up front for deterministic shared-worker runs. (#430, @abdullahmoh21, 2026-06-01)

### Changed

- [core] refactor: Wire RBAC into courses routes with session-based access control; allow `UNIT_ADMIN` to create/edit courses; add `department`+`isPublished` to API; replace `authorizedUnits` freetext with department checkboxes. (#491, @yta3216, 2026-06-03)
- [core] infra: Prisma migration `20260522130000_local_embeddings_vector_1024` — `material_embeddings.embedding` from `vector(3072)` to `vector(1024)` (clears incompatible rows; re-embed required). (#373, #441)
- [core] docs: Update [`EMBEDDINGS.md`](docs/rag-ai/EMBEDDINGS.md), [`ARCHITECTURE.md`](docs/ARCHITECTURE.md), `apps/core/.env.example`, and README for local embed env vars. (#370)
- [core] refactor: Move data fetching out of domain components into parent routes — `courses.$courseId` owns materials load/upload; `chat` owns `useApiKeys` / `ApiKeySettings`; `admin.ai-models` owns Ollama model fetch for `ModelFormDialog`. (#437, #438, 2026-06-03)
- [core] docs: Update `apps/core/README.md` — monorepo install from root, component architecture section, and expanded component test inventory. (#385, @Ayyhab, 2026-06-03)
- [monorepo] docs: Update root `README.md` with EduAI component skeleton overview and link to `apps/core/docs/`. (#385, @Ayyhab, 2026-06-03)
- [monorepo] infra: Port `docker:dev:db` and `kill:ports` scripts from bash to cross-platform Node.js (`scripts/dev-db.js`, `scripts/kill-ports.js`) so `npm run dev` works on Windows without WSL; add `apps/core/vitest.integration.config.ts` and `apps/extensions/ai-tutor/server/vitest.integration.config.js` for separate unit/integration vitest runs. (@evanbones, 2026-06-02)
- [core] api: Refactor course server handlers — replace `handleCourseRequest` with `getCourses`, `createCourse`, and `updateCourse`; expand create/update schemas for section, dates, department, publish flags, and `instructorUserIds`; `POST /api/courses` creates instructor enrollments in a transaction; `PATCH /api/courses/:id` takes `params.id` (admin, unit admin, or assigned instructor); `createCourseTopic` / `deleteCourseTopic` return HTTP status codes instead of string error codes; routes and unit/integration tests updated. (#392, @glowyblack, 2026-05-30)
- [monorepo] auth: Unify the auth frontend across apps so all three apps share a consistent sign-in surface. (#453, @evanbones, 2026-06-01)
- [core] auth: Enforce ADMIN-only access on `GET`/`POST /api/courses`; migrate remaining `professor` → `instructor` role references. (#430, @abdullahmoh21, 2026-06-01)
- [monorepo] auth: Rename the `PROFESSOR` role to `INSTRUCTOR` across all three apps — admin UI, auth schemas, middleware, and tests. (#430, @abdullahmoh21, 2026-06-01)
- [question-maker] refactor: Switch `eduaiService` to a pino logger and silence logs in tests. (#430, @abdullahmoh21, 2026-06-01)
- [question-maker] tests: Migrate backend integration tests from JWT auth to Core session-cookie auth; remove the obsolete `auth.integration.test.js` (register/login removed with JWT). (#453, @abdullahmoh21, 2026-06-01)
- [ai-tutor] chore: Upgrade `streamdown` to 2.5.0. (#430, @abdullahmoh21, 2026-06-01)
- [monorepo] infra: Unify shared infrastructure dependencies — pin `react`, `react-dom`, `zod`, `clsx`, and `class-variance-authority` via root npm `overrides` so they resolve to a single copy across all workspaces; hoist `typescript ^5.8.3`, `@types/node ^22`, `tsx ^4.19.4`, `nodemon ^3.1.10` to root `devDependencies` and remove per-workspace declarations from `edu-ai`, `ai-tutor`, `ai-tutor-server`, `question-maker-frontend`, and `question-maker-backend`; add `syncpack ^13` for ongoing version-drift detection. (@evanbones, 2026-06-03)

### Fixed

- [core] fix: Unblock vitest and align CoursesList unit-admin tests. (#491, @Ayyhab, 2026-06-04)
- [core] rag: Replace per-chunk sequential INSERT with `createManyAndReturn` + batched transaction on material embed path — chunk creation now costs 1 DB round-trip regardless of document size (down from N); embedding inserts remain individual raw SQL due to the pgvector type but run inside the same transaction. (#364, @ammaarm128, 2026-06-06)
- [core] rag: Eliminate double-split on material ingest path — `processMaterialEmbeddings` now detects `SEMANTIC_CHUNK_SEPARATOR` written by `processUploadedFile` and splits on it directly, preserving semantic chunks from `applySemanticChunking`; falls back to `generateChunks` for content that did not pass through the upload path. Previously, every uploaded file was semantically chunked in `file-processing.ts` and then immediately re-split by a naive sentence splitter in `embedding.ts`, destroying section boundaries. Re-upload existing materials to benefit. (#360, @ammaarm128, 2026-06-06)
- [core] tests: Add unit tests for `resolveMaterialChunks` — covers separator-preserving split, `generateChunks` fallback, and empty separator-only input. (#360, @ammaarm128, 2026-06-06)
- [core] fix: Local Ollama re-embed for large slide decks — use native `POST /api/embed`, smaller char-based chunks when PDF text has no sentence breaks (avoids `mxbai-embed-large` context-length 400), and batched embed with split-on-400; verified 7/7 materials on dev COSC 315. (#441)
- [core] fix: Scope persisted-course validation to the current user (#420 review) — the `/chat` loader now restores `lastCourseCode` against the courses the user can actually access (courses they teach, TA, or are actively enrolled in; admins see all) via new `getAccessibleCourseCodes` in `apps/core/app/lib/courses/server.ts`, instead of every course in the database. A course the user can no longer access is dropped on restore rather than treated as valid just because it still exists globally. Adds `apps/core/app/tests/unit/courses-server.test.ts`. (#420, review feedback from @Whiteknight07, @Ayyhab, 2026-06-05)
- [monorepo] infra: Replace em dash with hyphen in `scripts/dev-db.sh` Docker startup message to avoid PowerShell parse errors on Windows. (#438, @yta3216, 2026-06-03)
- [question-maker] api: Fix variant push to Core — support CUID string primary topic ids, lowercase `difficulty` / `reasoningLevel` enum values, return Core topic ids in the `INVALID_TOPIC_IDS` response, count name-updated topics in the sync-topics synced total, query JSON `question_order` with the `->>` operator, and wrap the cursor insert in a savepoint to survive a unique-key race. (#453, @abdullahmoh21, 2026-06-01)
- [question-maker] ui: Remove the local admin bug-reports page (`BugReportsAdminPage`, `/admin/bug-reports` route) and all navigation entry-points (`ProfileCoursesDialog`, `TopNavigation`) — the local Sequelize `BugReport` model was removed as part of centralization; reports are now written exclusively to Core, so the GET/PATCH admin routes no longer exist and the page was unreachable. (@evanbones, 2026-06-03)
- [ai-tutor] infra: Add `resolve.dedupe: ['react-router', 'react', 'react-dom']` to `apps/extensions/ai-tutor/vite.config.ts` to fix `Application Error` crash at `localhost:3001` — `useFrameworkContext` at `Meta` returned `undefined` because two copies of `react-router` were loaded (root `node_modules` has `7.6.1` for Core; AI Tutor local has `7.15.0`), giving `@react-router/dev`'s `FrameworkContext` provider and `Meta`'s `useContext` call different React Context object identities. (@evanbones, 2026-06-03)


---


## [Week 4 — May 25–29, 2026]

### Added
- [core] docs: IURA appendix scaffold for Form A §3b efficiency — records §3b on/off, evaluated git SHA, and parameter defaults at [`docs/literature/iura-appendix-3b-scaffold.md`](docs/literature/iura-appendix-3b-scaffold.md). (#262, @Ayyhab)
- [core] feat: Phase 2.5 §3b efficiency — cap oversized tool outputs before `streamText` (#260) and bounded session digest for long threads (#259). Shared limits in `chat-rag.ts`; wired in `POST /api/chat`. Validation runbook at [`docs/rag-ai/phase-2.5-s4-validation.md`](docs/rag-ai/phase-2.5-s4-validation.md) (#261).
- [core] api: Build `POST /api/bug-reports` — service-key-authenticated endpoint that accepts `source` (`AI_TUTOR` | `QUESTION_MAKER`), `userId` (Core CUID), `description` (≤ 2000 chars), `isAnonymous`, and optional diagnostic fields; validates payload and resolves user existence before writing to Core's `bug_reports` table; `userId` is always persisted for audit regardless of `isAnonymous`; returns `201` no body on success, `422 VALIDATION_ERROR` or `422 USER_NOT_FOUND` on failure. (#375, @evanbones, 2026-05-29)
- [core] tests: Add 17 unit tests (`bug-reports.test.ts`) and 9 integration tests (`bug-reports.integration.test.ts`) for `POST /api/bug-reports` — covers validation, USER_NOT_FOUND, AI_TUTOR and QUESTION_MAKER source tagging, anonymous persistence, service-key auth (401/403), and optional field round-trips against the real test DB. (#375, @evanbones, 2026-05-29)
- [ai-tutor] api: Wire `POST /api/bug-reports` to Core — add `postCoreBugReport(userId, payload)` to `eduaiClient.js` (service-key Bearer auth, `source: "AI_TUTOR"`); replace `prisma.bugReport.create` in `bugReports.js` with the Core call; local validation (description length, context hierarchy, RBAC) is unchanged; route now returns `{ ok: true }` on success. (#375, @evanbones, 2026-05-29)
- [question-maker] api: Add `POST /api/bug-reports` route to QM backend — auth-protected via `requireAuth`, forwards payload to Core with `source: "QUESTION_MAKER"` and `userId: req.user.id` under the service key; passes `422` errors through; returns `201 { success: true }` on success. (#375, @evanbones, 2026-05-29)
- [core] auth: Implement `POST /api/sessions/validate` — accepts a forwarded session cookie from extension middleware, validates it via Better Auth, and returns `{ user: { id, email, name, image, role } }` or `401 Unauthorized`; add IP-based sliding-window rate limiter (`rate-limit.server.ts`, 300 req/min default, tunable via `SESSION_VALIDATE_RATE_LIMIT`). Phase 1 of auth pipeline centralization (blocks both extension migrations). (#344, @evanbones, 2026-05-25)
- [core] auth: Add `validateRedirectUrl` to `guards.server.ts` — validates the `?redirect=<url>` param on the login page; allows relative paths (`/...`) and absolute URLs under `localhost` (dev) or `*.eduai.ok.ubc.ca` (prod); rejects everything else and falls back to `/dashboard` to prevent open-redirect attacks. (#344, @evanbones, 2026-05-25)
- [core] auth: Wire `?redirect=<url>` support into Core login page (`/auth/login`) — loader validates and threads the return URL through a hidden form field; action uses the validated URL in the post-login redirect; already-authenticated users landing on the login page are forwarded to the return URL directly. (#344, @evanbones, 2026-05-25)
- [core] tests: Add 8 integration contract tests for `POST /api/sessions/validate` — covers valid session → 200 + correct user shape, missing/expired session → 401, rate-limited IP → 429, non-POST method → 405, `x-forwarded-for` IP extraction, and `role` defaulting to `STUDENT` when undefined. (#344, @evanbones, 2026-05-25)
- [core] tests: Add 13 unit tests for `validateRedirectUrl` in `guards.server.test.ts` — covers null/empty inputs, valid relative paths, protocol-relative URL rejection, localhost and 127.0.0.1 passthrough, production apex and subdomain passthrough, external domain rejection, suffix-spoofing rejection, non-URL strings, and `javascript:` URIs. (#344, @evanbones, 2026-05-25)
- [core] tests: Add 6 unit tests for `isRateLimited` in `rate-limit.server.test.ts` — covers under-limit passthrough, limit-exceeded rejection, per-IP independence, window expiry via fake timers, and `SESSION_VALIDATE_RATE_LIMIT` env var reading. (#344, @evanbones, 2026-05-25)
- [ai-tutor] auth: Replace Better Auth + OAuth PKCE middleware with Core session cookie validation — rewrite `server/src/middleware/auth.js` to call `POST /api/sessions/validate` on Core, populate `req.user` with `{ id, email, name, image, role }`, normalize unknown roles to `STUDENT`, and redirect unauthenticated requests to `{CORE_URL}/login?redirect=<url>` (AT-A, AT-B); tombstone `server/src/auth.js` (AT-C); add Prisma migration to drop `User`, `Session`, `Account`, `Verification` tables (AT-D); remove `better-auth` package (AT-F). Phase 2a of auth pipeline centralization. (#350, @evanbones, 2026-05-25)
- [ai-tutor] auth: Replace `getEduAiAccessTokenForUser` OAuth token lookup with `getEduAiCookieForRequest` cookie-forwarding helper — all EduAI API calls now forward the browser session cookie instead of using a separate OAuth access token; update `eduaiClient.js`, `aiGuidance.js`, `topicSync.js`, and all calling routes. (#350, @evanbones, 2026-05-25)
- [ai-tutor] auth: Add `requireRole` / `requireRoles` RBAC factory to `middleware/auth.js` — accepts a single role string or an array; `requireRoles` is a backward-compat alias; `normalizeRole` defaults unknown roles to `STUDENT` (least privilege). Implements §7 of auth-pipeline-centralization-plan. (#350, @evanbones, 2026-05-25)
- [ai-tutor] tests: Add 16 unit tests for `requireAuth` and `requireRole` middleware (`tests/unit/auth.middleware.test.js`) — covers valid session populates `req.user`, non-ok Core response returns 401, unreachable Core returns 401, cookie forwarding, empty-cookie fallback, role normalization to STUDENT, all five valid roles preserved, `requireRole` string/array forms, 403 on wrong role, 401 on missing user, error message content, and `requireRoles` alias identity. (#350, @evanbones, 2026-05-25)
- [ai-tutor] tests: Update `tests/helpers.js` — remove stale `prisma.user`, `prisma.account`, `prisma.session`, `prisma.verification`, `prisma.courseInstructor`, `prisma.courseEnrollment` calls from `truncateAll()` and `seedMinimalCourse()` (these models were removed from the AT Prisma schema in the schema_unification migration; auth is now owned by Core). (#350, @evanbones, 2026-05-25)
- [ai-tutor] tests: Update `tests/integration/auth.test.js` — remove `prisma.user.create()` calls; `mockUser` bypasses Core session validation so no local DB row is needed; drop the `GET /api/admin/users` test that called a broken route (route uses `prisma.user.findMany()` which is not in the schema). (#350, @evanbones, 2026-05-25)
- [ai-tutor] tests: Update `tests/integration/admin.test.js` — skip enrollment and user-list tests that depend on `prisma.user` / `prisma.courseEnrollment` (not in AT Prisma schema; pre-existing breakage from schema_unification); keep and fix tests for `PATCH /api/admin/users/:id/role` (410 GONE), `GET /api/admin/courses`, and `GET /api/admin/settings/eduai-api-key`. (#350, @evanbones, 2026-05-25)
- [question-maker] auth: Replace JWT middleware with Core session cookie validation — rewrite `src/middleware/auth.js` to call `POST /api/sessions/validate` on Core, find-or-create a local user row for FK integrity on first login, redirect unauthenticated non-API paths to Core login, return 401 JSON for API paths (QM-A, QM-B); remove `POST /api/auth/register` and `POST /api/auth/login` endpoints (QM-C, QM-D); replace `authService.js` register/login logic with `findOrCreateUser(coreUser)` (QM-E); remove `JWT_SECRET`/`JWT_EXPIRES_IN` from `.env.example`, add `CORE_URL`/`EXTENSION_URL` (QM-H). Phase 2b of auth pipeline centralization. (#350, @evanbones, 2026-05-25)
- [question-maker] auth: Add `requireRole` RBAC factory and `authenticateToken` backward-compat alias to QM auth middleware — same pattern as AI Tutor; existing route files continue to work without changes. Implements §7 of auth-pipeline-centralization-plan for QM. (#350, @evanbones, 2026-05-25)
- [question-maker] tests: Add 14 unit tests for QM `requireAuth`, `requireRole`, and `authenticateToken` middleware (`tests/unit/auth.middleware.test.js`) — covers valid session, `findOrCreateUser` call, 401 JSON for API paths, login redirect for non-API paths, unreachable Core, cookie forwarding, role normalization, all five valid roles, role string/array forms, 403 on wrong role, 401 on missing user, and `authenticateToken` alias identity. (#350, @evanbones, 2026-05-25)
- [question-maker] tests: Replace `tests/unit/authService.test.js` — old tests verified JWT `verifyToken` (now removed); new tests verify `findOrCreateUser` for existing user (no seed), new user (seeds courses), null-name handling, and correct Sequelize `findOrCreate` call shape. (#350, @evanbones, 2026-05-25)
- [monorepo] docs: Add summer 2026 chat latency investigation write-ups under [`docs/rag-ai/latency/eduai-summer-2026/`](docs/rag-ai/latency/eduai-summer-2026/) — [`FINDINGS.md`](docs/rag-ai/latency/eduai-summer-2026/FINDINGS.md) (team summary), [`FINDINGS_APPENDIX.md`](docs/rag-ai/latency/eduai-summer-2026/FINDINGS_APPENDIX.md) (sessions, methodology, data index on `troubleshoot-RAG-delay`), and [`SOLUTIONS_PLAN.md`](docs/rag-ai/latency/eduai-summer-2026/SOLUTIONS_PLAN.md) (mitigations: keep-alive, routing, token caps, cold-load UX). Docs-only; benchmark JSON/CSV and bench tooling remain on branch `troubleshoot-RAG-delay`. ([#383](https://github.com/EduAI-Lab/EduAI/pull/383), @superbolt08, 2026-05-29)
- [monorepo] tests: Introduced Docker-based test infrastructure across all components (EduAI, AI Tutor app/server, Question Maker app/server). Added multi-stage Dockerfiles with a lockfile-exact `deps` stage, restructured `docker-compose.test.yml` into a consistent `{component}-{app|server}-{unit|integration}-tests` naming scheme, added `unit`/`integration` group arguments to `test-in-docker.sh`, and added corresponding npm scripts. (#352, @yta3216, 2026-05-27)
- [core] feat: ADHD Assist Phase 2 — mode-conditional system prompt. When `Chat.adhdAssist === true`, `POST /api/chat` prepends the verbatim policy block from `docs/literature/adhd-assist-prompt-policy.md` §3 to the resolved system prompt before `streamText`. Style is the only IV — model, retrieval, tools, persistence, temperature, and streaming behavior are unchanged. New `apps/core/app/lib/ai/adhd-assist.ts` exports `ADHD_ASSIST_POLICY_BLOCK` and `composeSystemPrompt(base, { adhdAssist })`. Single call site in `chat.ts` covers both the tool-supporting and no-tool RAG branches. (#255, #256, #258, @Ayyhab, 2026-05-29)
- [core] tests: Unit tests for `composeSystemPrompt` covering identity, prepend, course-context preservation, empty/whitespace base, and verbatim policy-block anchors at `apps/core/app/tests/unit/adhd-assist.test.ts`. (#255, @Ayyhab, 2026-05-29)
- [core] tooling: Add `apps/core/scripts/eval-adhd-assist.mjs` and `npm run eval:adhd` — pure-Node runner that drives Form A S1/S2/S3 (+ optional S5) through `POST /api/chat` twice each (Baseline vs ADHD Assist) and emits a results matrix (markdown table, per-pair transcripts, `results.csv`, `run-meta.json` with git SHA and redacted env presence booleans). Adds `eval-runs/` to root `.gitignore` so research outputs stay out of git. (#258, @Ayyhab, 2026-05-29)
- [core] feat: OpenRouter embedding provider — `OPENROUTER_API_KEY` routes RAG indexing and query embeds through OpenRouter (`google/gemini-embedding-001`, 3072-dim) before direct Google/OpenAI fallbacks; add `npm run test:embedding` smoke script. Docs: [`EMBEDDINGS.md`](docs/rag-ai/EMBEDDINGS.md), [`ARCHITECTURE.md`](docs/ARCHITECTURE.md), dev server runbook. (#PR)
- [core] tests: Unit tests for `forward-session-cookies` and `auth-handler-request` (auth cookie forwarding and sign-in/sign-out sub-requests). (#PR)
- [monorepo] docs: Add `docs/implementations/shared-component-library-audit.md` — audit of UI components that are candidates for a shared component library across AI Tutor, Question Maker, and EduAI; covers component structure, behaviour, accessibility requirements, and UBC brand token constraints. (#376, @yta3216, 2026-05-29)

### Changed
- [core] docs: Update `apps/core/README.md` `POST /api/chat` body table — `adhdAssist` now describes the active Phase 2 behavior (policy-block prepend) instead of the Phase 1 "no behavioural effect" placeholder. (@Ayyhab, 2026-05-29)
- [core] fix: `POST /api/chat` now honours the persisted `Chat.adhdAssist` when an API client omits the `adhdAssist` field, instead of silently treating the omission as `false`. New `resolveEffectiveAdhdAssist({ hasField, bodyValue, chatValue })` helper in `apps/core/app/lib/ai/adhd-assist.ts` is the single source of truth for the body-vs-persisted resolution; the same precedence already governs `resolvedSystemPrompt` at `chat.ts:603`. UI and `eval:adhd` always send the field, so no observable behavior change for those callers. (#377 review feedback from @Whiteknight07, @Ayyhab, 2026-05-31)
- [core] tests: Add 4 unit tests for `resolveEffectiveAdhdAssist` at `apps/core/app/tests/unit/adhd-assist.test.ts` covering body-overrides-persisted (both directions) and field-absent fallback (both persisted values). (#377, @Ayyhab, 2026-05-31)

### Fixed
- [core] fix: Phase 2.5 §3b review feedback (#443) — session char budget now counts tool-call/result payloads via `estimateMessageCharsForModel`, so the digest triggers and `messageTextChars` is accurate on tool-heavy threads; `prepareBoundedSessionContext` enforces the final char budget over digest + recent tail and truncates a single over-budget message. Shared tool-output limits extracted to `apps/core/app/lib/ai/tool-output-limits.ts` (imported by `fetch-page.ts`/`chat-rag.ts`). Adds unit tests for tool-invocation shapes and budget enforcement; documents `CHAT_*` chat-context vars in `.env.example`, [`CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md), and [`MODEL_LATENCY_TRACKER.md`](docs/rag-ai/latency/MODEL_LATENCY_TRACKER.md) (corrects stale `10000` default to `6000`). (#259, #260, review feedback from @superbolt08, @Ayyhab, 2026-06-05)
- [core] fix: Better Auth on HTTPS dev host — top-level `baseURL`/`secret`, `useSecureCookies`, disable cross-subdomain cookies unless `COOKIE_DOMAIN` is set; forward all session cookies on login/register redirect; server `POST /auth/logout`; omit stale cookies on sign-in. Dev runbook: [`HOW_TO_USE_DEV_SERVER.md`](docs/rag-ai/HOW_TO_USE_DEV_SERVER.md). (#PR)

---

## [Week 3 — May 18–22, 2026]

### Added
- [core] perf: Cap hybrid RAG context (`buildCappedRagContextText`, `capRagHitsForTool`), bound retrieved chunks, query-embedding cache, batched `embedMany`, and env-tunable tool limits; add `chat-rag.ts`, `chat-api-keys.schema.ts`, and `chat-latency-bench.mjs`. (#144, @superbolt08, 2026-05-22)
- [core] tests: Unit tests for `chat-rag`, `chat-api-keys.schema`, and `generateChunks` in embedding. (#144, @superbolt08, 2026-05-22)
- [core] auth: Add Better Auth `apiKey` server plugin and matching `apiKeyClient` for Settings / bench `x-api-key` access. (#144, @superbolt08, 2026-05-22)
- [core] feat: Add user-facing ADHD Assist toggle on `/chat` (Phase 1 plumbing only). New `Chat.adhdAssist Boolean @default(false)` column + migration `adhd_assist_toggle`; toggle persists per chat and restores on reload via `/api/chats/:chatId`. `adhdAssist` is parsed and stored by `POST /api/chat` but does not alter prompt, model, RAG, or tools — Phase 1 is the IV control before Phase 2 introduces the policy prepend. (#151, @Ayyhab, 2026-05-20)
- [monorepo] docs: Add `auth-pipeline-centralization-plan.md` — detailed plan for centralizing all extension auth through Core's OAuth/OIDC provider; covers current state audit (AI Tutor centralized, Question Maker standalone JWT), gap analysis, phased migration plan, auth contract, and AI Tutor as the reference implementation for QM. (#250, @evanbones, 2026-05-20)
- [monorepo] docs/tooling: Add `eduai-summer-2026/CONVENTIONS.md` — consolidated reference for issue format, git workflow, and PR checklist readable by any AI agent; add `.claude/commands/eduai-summer-2026/make-pr.md` — Claude Code `/project:eduai-summer-2026:make-pr` slash command that walks contributors through the PR checklist interactively; un-ignore `.claude/` in `.gitignore` so commands are team-shared. (#289, @ariqmuldi, 2026-05-21)
- [core] tests: Finished implementing all the tests inside of the `planned-core-tests.md`
- [monorepo] docs: Added docs/implementations/rbac-matrix.md (#198, @abdullahmoh21, 2026-05-21)
- [monorepo] docs: Add [`docs/rag-ai/`](docs/rag-ai/README.md) — index and team docs for EduAI chat/RAG ([`CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md)), shared dev server ([`HOW_TO_USE_DEV_SERVER.md`](docs/rag-ai/HOW_TO_USE_DEV_SERVER.md)), HelpMe gap analysis, **latency** sprint guides and measurement ledger ([#203](https://github.com/EduAI-Lab/EduAI/issues/203)), and **routing** Phase 0–1 guides ([#197](https://github.com/EduAI-Lab/EduAICore/issues/197)).
- [monorepo] docs: Populated `TESTS.md` with all integration and unit tests (#199, @GlowyBlack, 2026-05-18)
- [monorepo] infra: Add GitHub Actions CI workflow (`.github/workflows/pr-tests.yml`) — triggers on pull requests targeting `development` or `main`; spins up a PostgreSQL 16 service on port 54321; runs `npm run test` (Turborepo) to build and test all packages across the monorepo; `aitutor_test` database is created automatically by the existing `globalSetup.js`; `TEST_DATABASE_URL` is set at job level so question-maker backend integration tests run as part of the single test command. (#236, @evanbones, 2026-05-20)
- [question-maker] infra: Make `npm run test` run the full test suite — chain `vitest run --config vitest.integration.config.js` after the unit run so integration tests are no longer opt-in; `test:all` is kept as an alias. (#236, @evanbones, 2026-05-20)
- [monorepo] docs: added new .md file updating the schema based on LTI implementation. (#330, @frostbitcactus, 2026-05-22)
- [monorepo] docs: Add [`docs/rag-ai/EMBEDDINGS.md`](docs/rag-ai/EMBEDDINGS.md) — embeddings and pgvector storage, server vs chat API keys, index/retrieval lifecycle, hosting, failures, and env vars (@superbolt08, 2026-05-21)
- [core] prisma: Add `routing_telemetry_mvp` migration — extend `AIInteraction` with routing, timing, split token counts (`promptTokens`, `completionTokens`), cost, and energy/carbon fields; add `RouterTier` and `EnergyMeasurementSource` enums; extend `AIModel` with `routerTier`, `estEnergyJoulesPerToken`, and `averageCarbonGramsPerToken` (nullable, Phase 0 routing). (#320, @superbolt08, 2026-05-22)
- [monorepo] docs: created a `broken-routes.md` file listing everything that will no longer work with the unified schema (#338, @glowyblack, 2026-05-24)
- [core] test: Created the setup for running integration tests on core, as well as a `planned-core-integration-test.md` listing the tests still needed for the test. (#338, @glowyblack, 2026-05-24)
- [core] api: Implement `api-wiring.md` course/topic endpoints and tests — `GET /api/courses/:id` loader (flat course, `COURSE_NOT_FOUND`); new `GET /api/courses/:courseId/topics/:topicId` (flat topic, `TOPIC_NOT_FOUND`); topics GET/POST/DELETE accept `requireServiceKey` (`Bearer EDUAI_API_KEY`) or session; POST returns `409 TOPIC_ALREADY_EXISTS` with `existingId`; server helpers filter `deletedAt: null` and soft-delete on topic DELETE; integration tests (`courses`, `courses.id`, `courses-topic`, `service-key`) and unit tests (`courses.server`, `courses.id.loader`, `courses.topics`); `TESTS.md` updated. (#338, @glowyblack, 2026-05-24)

### Changed
- [core] docs: Update [`docs/rag-ai/CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md) for capped hybrid/tool RAG, env vars, and optional `similarityThreshold` on `findRelevantContent`; merge with `development` rag-ai index. (#144, @superbolt08, 2026-05-22)
- [monorepo] docs: Root README — `docs/rag-ai/` table links, chat latency bench section, and repo structure `rag-ai/` folder. (#144, @superbolt08, 2026-05-22)
- [monorepo] docs/tooling: Update `eduai-summer-2026/CONVENTIONS.md` and `.claude/commands/eduai-summer-2026/make-pr.md` — add assignee and week-label requirements to issue conventions; expand test conventions to cover unit, integration, and end-to-end tests; update make-pr skill to verify week labels on linked issues and determine applicable test types. (#318, @ariqmuldi, 2026-05-22)
- [monorepo] docs: Move RAG-AI team docs from `docs/implementations/RAG-AI/` to [`docs/rag-ai/`](docs/rag-ai/README.md); normalize folder name and filenames (`CHAT_RAG_PIPELINE.md`, `HOW_TO_USE_DEV_SERVER.md`, summer-2026 subfolders); update root README, [`ARCHITECTURE.md`](docs/ARCHITECTURE.md), and cross-links.
- [monorepo] docs: Add chat/RAG pipeline section to [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) linking to [`CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md).
- [monorepo] docs: Extend root README Docs table with links to `docs/rag-ai/` and `implementations/schema-design.md`.
- [ai-tutor] infra: Renamed the `test/` `__test__` to `tests/` and added the tests within the `app/tests/` to the `TESTS.md` file and created a `.env.test.example` file. Added `.env.test` to gitignore (#199, @glowyblack, 2026-05-18)
- [monorepo] docs: Update [`docs/rag-ai/README.md`](docs/rag-ai/README.md) index and folder layout for `EMBEDDINGS.md`; cross-link [`CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md) and [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) to the embeddings guide; extend root README Docs table (@superbolt08, 2026-05-21)
- [core] prisma: Drop legacy `AIInteraction.tokenUsed` in favor of `promptTokens` + `completionTokens` to avoid conflicting token totals. (#320, @superbolt08, 2026-05-22)
- [core] prisma: Restore `schema_unification` migration to original SQL; routing/energy columns live only in `routing_telemetry_mvp` so existing local DBs can migrate cleanly. (#320, @superbolt08, 2026-05-22)
- [monorepo] docs: created a `broken-routes.md` file listing everything that will no longer work with the unified schema (#338, @glowyblack, 2026-05-24)
- [core] test: Created the setup for running integration tests on core, as well as a `planned-core-integration-test.md` listing the tests still needed for the test. (#338, @glowyblack, 2026-05-24)
- [core] api: Implement `api-wiring.md` course/topic endpoints and tests — `GET /api/courses/:id` loader (flat course, `COURSE_NOT_FOUND`); new `GET /api/courses/:courseId/topics/:topicId` (flat topic, `TOPIC_NOT_FOUND`); topics GET/POST/DELETE accept `requireServiceKey` (`Bearer EDUAI_API_KEY`) or session; POST returns `409 TOPIC_ALREADY_EXISTS` with `existingId`; server helpers filter `deletedAt: null` and soft-delete on topic DELETE; integration tests (`courses`, `courses.id`, `courses-topic`, `service-key`) and unit tests (`courses.server`, `courses.id.loader`, `courses.topics`); `TESTS.md` updated. (#338, @glowyblack, 2026-05-24)
- [core] auth: Add `requireServiceKey` guard (`Authorization: Bearer <EDUAI_API_KEY>`, `crypto.timingSafeEqual`); wire into `GET /api/courses/:id/topics` as service-key auth path. (#337, @yta3216, 2026-05-23)
- [monorepo] infra: Add `npm run dbseed` root script that seeds Core, AI Tutor, and Question Maker databases in order (Core → AI Tutor → QM); safe to run at any time — Core and AI Tutor seeds are fully idempotent via upserts. (#NNN, @evanbones, 2026-05-22)
- [core] infra: Auto-seed the Core database on `npm run dev` when the database is empty — new `db:seed:if-empty` script checks user count and skips seeding if data already exists, so normal dev restarts are unaffected. (#NNN, @evanbones, 2026-05-22)
- [ai-tutor] infra: Auto-seed the AI Tutor database on `npm run dev` when the database is empty — new `seed:if-empty` script checks prompt template count (required for runtime) and skips if data exists. (#NNN, @evanbones, 2026-05-22)

### Removed
- [monorepo] infra: Remove nested `package-lock.json` files from npm workspace packages (`ai-tutor`, `ai-tutor/server`, `question-maker/app/backend`) - holdovers from before the monorepo workspace setup that were not read by npm or Turborepo on root installs; add `apps/**/package-lock.json` to `.gitignore` to prevent accidental regeneration. (#268, @yta3216, 2026-05-20)

### Fixed
- [core] infra: Restrict Vite `allowedHosts` to `dev.eduai.ok.ubc.ca`, `localhost`, and `127.0.0.1`; use `resolve.dedupe` for `better-auth` instead of a package-root alias that broke subpath exports. (#144, @superbolt08, 2026-05-22)
- [monorepo] docs: Remove stale `professorId` references from `docs/implementations/rbac-matrix.md` — the field no longer exists in the schema; rephrase the §1 instructor-linkage note and the §20 gap entries to refer to `Enrollment.role=INSTRUCTOR` instead. (@abdullahmoh21, 2026-05-22)
- [monorepo] infra: Fix `npm run dev` failing on restart — Docker orphaned containers from previous service renames (`eduai-core-db`, `eduai-tutor-db`, `eduai-qm-db`) held ports 54320–55432 and were not removed by `docker compose down`; overhaul `scripts/dev-db.sh` to force-remove any container bound to those ports and delete the stale `eduai-dev` network before starting fresh; add `--remove-orphans` to `docker:dev:db:down`. (#236, @evanbones, 2026-05-19)
- [question-maker] infra: Fix `vitest.integration.config.js` using wrong `test/` path instead of `tests/` — integration tests were never discovered and `test:all` always exited with code 1 (@ariqmuldi, 2026-05-20)
- [monorepo] docs: Corrected README paths, CHANGELOG structure, and removed redundant TESTS.md placeholder. (#329, @evanbones, 2026-05-22)
- [core] auth: Add `requireServiceKey` guard (`Authorization: Bearer <EDUAI_API_KEY>`, `crypto.timingSafeEqual`); wire into `GET /api/courses/:id/topics` as service-key auth path. (#337, @yta3216, 2026-05-23)
- [monorepo] infra: Add `npm run dbseed` root script that seeds Core, AI Tutor, and Question Maker databases in order (Core → AI Tutor → QM); safe to run at any time — Core and AI Tutor seeds are fully idempotent via upserts. (#NNN, @evanbones, 2026-05-22)
- [core] infra: Auto-seed the Core database on `npm run dev` when the database is empty — new `db:seed:if-empty` script checks user count and skips seeding if data already exists, so normal dev restarts are unaffected. (#NNN, @evanbones, 2026-05-22)
- [ai-tutor] infra: Auto-seed the AI Tutor database on `npm run dev` when the database is empty — new `seed:if-empty` script checks prompt template count (required for runtime) and skips if data exists. (#NNN, @evanbones, 2026-05-22)

---

## [Week 2 — May 11–15, 2026]

### Added
- [monorepo] automation: Add GitHub-native weekly team time tracking and PR analytics reporting workflows, including issue-hours parsing, committed base-time fallback, editable weekly base-time issue override, Project timestamp filtering, Project item/PR linking, CSV/Markdown report generation, implementation documentation, and focused Node tests for the reporting scripts. (#176, @Whiteknight07, 2026-05-16)
- [monorepo] docs: Add `schema-design.md` in `docs/implementations/` — unified schema design (#177, @abdullahmoh21, 2026-05-16)
- [monorepo] docs: Added DEPLOYMENT.md in docs based on team decision (#157, @abdullahmoh21, 2026-05-15)
- [core] infra: Add unit tests for all functions in `lib/form-utils.ts` (`getFieldErrors`, `getFieldError`, `getFormErrorMessage`, `validateField`); set `pool: vmThreads` in `vitest.config.ts` to fix worker startup timeout on Windows. (#134, @glowyblack, 2026-05-13)
- [core] docs: Add `TEST.md` cataloguing all planned test cases for `lib/utils`, `lib/ai/providers`, `lib/ai/file-processing`, `lib/ai/embedding`, `lib/courses/schemas`, `lib/ai/schemas`, and form components (`LoginForm`, `RegisterForm`); assign test files across three contributors. (#134, @glowyblack, 2026-05-13)
- [monorepo] infra: Set up Turborepo to orchestrate build, dev, test, and lint across all workspace apps; add `apps/extensions/ai-tutor/server` to npm workspaces; configure distinct dev-server ports (core: 3000, ai-tutor: 3001, qm-frontend: 5173, qm-backend: 8000, ai-tutor server: 4000); add `predev` hook that auto-starts Docker Compose databases before Turborepo; add `postinstall` hook that copies each app's `.env.example` to `.env` on a clean clone; add `.npmrc` (`legacy-peer-deps=true`) to resolve cross-package peer dependency conflicts; change core-db default host port from 5432 to 54320 to avoid collision with locally installed Postgres. (#133, @evanbones, 2026-05-13)
- [monorepo] docs: Add `docs/DEPLOYMENT.md` with production topology and a Development Deployment guide for `dev.eduai.ok.ubc.ca` (SSH, tmux, branch switching, when to use the dev server vs local dev, Ollama). (#110, @superbolt08, 2026-05-12)
- [core] infra: Add `rhel-openssl-1.1.x` to Prisma `binaryTargets` so the query engine works on RHEL 8 hosts (e.g. `dev.eduai.ok.ubc.ca`). (#110, @superbolt08, 2026-05-12)
- [core] infra: Configure Vite for monorepo hoisting, Apache reverse proxy (`allowedHosts`, `fs.allow`), optional HMR over HTTPS (`DEV_SERVER_HMR_*`), and `better-auth` dedupe on the dev host. (#110, @superbolt08, 2026-05-12)
- [monorepo] docs: Add root `TESTS.md` as the canonical test inventory — defines structure, policy, and per-section table format for tracking all test files across the monorepo. (#140, @ariqmuldi, 2026-05-13)
- [monorepo] infra: Add root `package.json` with unified test runner. `npm test` at the root directory runs all unit tests across every app. (#119, @yta3216, 2026-05-12)
- [core] infra: Set up Vitest test infrastructure: add `vitest.config.ts`, `app/tests/setup.ts`, and `test`/`test:watch` scripts to `package.json`. No tests written yet; scaffolding only. (#119, @yta3216, 2026-05-12)
- [core] docs: Add `TESTS.md` with planned test cases for lib utilities, AI providers, file processing, Zod schemas, and form components. (#119, @yta3216, 2026-05-12)
- [core] docs: Add `docs/RAG-AI/CHAT_RAG_PIPELINE.md` documenting the `POST /api/chat` flow, hybrid RAG, and embedding behavior for latency profiling. (#144, @superbolt08, 2026-05-14)
- [core] infra: Add `scripts/chat-latency-bench.mjs` for non-streaming `POST /api/chat` latency measurement. (#144, @superbolt08, 2026-05-14)

### Changed
- [monorepo] automation: Move summer 2026 team time reporting scripts, tests, base-time CSVs, generated reports, and documentation under `eduai-summer-2026/`; keep workflow entrypoints as prefixed files in `.github/workflows/` for GitHub Actions autodiscovery. (#176, @Whiteknight07, 2026-05-18)
- [core] docs: Renamed the planned test file for core from `TEST.md` to `planned-core-tests.md` and moved to docs to reflect the `README.md` and fix the conflict with the new `TEST.md` file that describes structure for all new tests. (#134, @glowyblack, 2026-05-14)
- [monorepo] docs: Move `TEST.md` from `apps/core/` to the monorepo root so it is visible alongside `CHANGELOG.md` and other top-level docs. (#134, @glowyblack, 2026-05-13)
- [core] infra: Rename test folder from `app/__tests__/` to `app/tests/` and reorganise test files into `app/tests/unit/`; update `vitest.config.ts` `include` and `setupFiles` paths accordingly. (#134, @glowyblack, 2026-05-13)
- [qm] infra: Complete migration of question-maker-backend and question-maker-frontend test suites from Jest to Vitest — update `package.json` test scripts to invoke `vitest run` using the existing `vitest.config.js` / `vitest.integration.config.js` configs; fix `@testing-library/jest-dom` setup to use explicit `expect.extend(matchers)` instead of the broken `/vitest` entry point; add `resolve.dedupe` to `vite.config.ts` to guard against future React version drift. (#137, @evanbones @abdullahmoh21, 2026-05-15)
- [monorepo] infra: Rename workspace packages — `edu-ai-core-learning` → `edu-ai`, `aitutor` → `ai-tutor`, `server` → `ai-tutor-server` — so Turborepo labels output as `edu-ai:dev`, `ai-tutor:dev`, `ai-tutor-server:dev`. (commit 93d9b46, @ariqmuldi, 2026-05-14)
- [monorepo] infra: Standardize Docker Compose project name, service names, volume names, and npm scripts — set project name to `eduai` so volumes are prefixed `eduai_`; rename services `core-db` → `eduai-db`, `tutor-db` → `ai-tutor-db`, `qm-db` → `question-maker-db`; rename volumes to `db_data`, `ai_tutor_db_data`, `question_maker_db_data`; rename scripts `docker:dev:db:core/tutor/qm` → `docker:dev:db:eduai/ai-tutor/question-maker`. (commit 523c7e2, @ariqmuldi, 2026-05-14)
- [monorepo] infra: Broaden Turbo test task `inputs` to cover `app/**`, `server/**`, `shared/**`, `test/**`, `vitest.config.*`, `jest.config.*`, `jest.integration.config.*`, `package.json`, `prisma/**`, and `tsconfig*.json` — previously narrow inputs caused stale cache hits after real test-affecting changes. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Update root README `npx turbo run` filter examples to use correct package names (`aitutor --filter=server`, quoted `'question-maker-*'` for zsh compatibility) and `npx turbo run test` syntax in the testing table. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Add Testing section to root README covering install prerequisites, all root-level test commands, integration test database requirements, and a per-app runner reference table. (#119, @yta3216, 2026-05-12)
- [ai-tutor] chore: Migrate package manager from Bun to npm — updated all scripts, dependencies, hooks, deploy tooling, and documentation to use npm throughout. (#118, @abdullahmoh21, 2026-05-12)

### Fixed
- [ai-tutor] fix: Replace ts-node with tsx in the server seed script — ts-node does not support ESM TypeScript (`"type": "module"`) without extra flags; tsx runs `.ts` files natively under Node ESM. Added TypeScript types to previously untyped seed helper functions. (#118, @abdullahmoh21, 2026-05-12)
- docs: Merge monorepo report information into platform centralization document. Changed section 12 to be a description of the monorepo architecture. (#107, @evanbones, 2026-05-11)
- [monorepo] infra: Rename Docker container names — `eduai-core-db` → `eduai-db`, `eduai-tutor-db` → `eduai-ai-tutor-db`, `eduai-qm-db` → `eduai-question-maker-db`; rename Postgres database names — `aitutor` → `ai-tutor`, `eduquery` → `question-maker`; update all `.env`, `.env.example`, and `.env.test` files accordingly. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Rename "EduAI Core" to "EduAI" across root README, CHANGELOG, apps/core README, and all docs — platform-centralization-architecture-plan.md, user-management-and-roles-architecture-plan.md, QUESTION_MAKER_INTEGRATION_SUMMARY.md. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Add database inspection section to root README — `docker exec` + psql workflow (`\c`, `\dt`, `SELECT * FROM`) and step-by-step DBeaver/pgAdmin connection guide for all three databases. (#133, @evanbones, 2026-05-14)
- [monorepo] infra: Rename root npm workspace package from `eduaicore-monorepo` to `eduai-monorepo`. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Mark user management and roles plan as on hold pending Canvas integration — current roles frozen, Canvas identified as source of truth for course structure, enrollments, and role assignments; rest of document preserved as original draft. (#115, @ariqmuldi, 2026-05-11)
- [core] perf: Cap hybrid RAG context and bound retrieved chunks in chat; trim verbose debug logging on the chat API path. (#144, @superbolt08, 2026-05-14)
- [core] model: Improve embedding generation with caching, batch processing, and clearer error handling. (#144, @superbolt08, 2026-05-14)
- [core] infra: Restrict Vite `allowedHosts` to `dev.eduai.ok.ubc.ca`, `localhost`, and `127.0.0.1` for remote development behind the Apache reverse proxy without opening the dev server to arbitrary Host headers. (#144, @superbolt08, 2026-05-14)

### Fixed

- [core] deps: Resolve dependency alignment issues uncovered during chat latency investigation. (#144, @superbolt08, 2026-05-14)

### Removed
- [monorepo] infra: Remove duplicate Turbo task delegation from `apps/extensions/question-maker/package.json` — the parent workspace package was re-invoking turbo for `question-maker-frontend` and `question-maker-backend`, causing build and test tasks to run twice. (#133, @evanbones, 2026-05-14)
- docs: Removed old monorepo report since the information is now included in the centralization docs. (#107, @evanbones, 2026-05-11)

### Fixed
- [monorepo] infra: Run `prisma migrate deploy` automatically on dev start for `edu-ai` and `ai-tutor-server` — databases had no tables on a fresh clone because migrations were never applied before the dev server started. (commit 83bb75c + 1be5058, @ariqmuldi, 2026-05-14)
- [core] auth: Remove `apiKey` plugin from `app/lib/auth/server.ts` — not exported by `better-auth@1.2.8`, causing a runtime crash on every page load. (commit e797e15, @ariqmuldi, 2026-05-14)
- [question-maker] backend: Fix `DATABASE_URL` in `.env.example` — was pointing to non-existent database `question-maker` but Docker Compose created it as `eduquery`; corrected to match the compose config. (commit 523c7e2, @ariqmuldi, 2026-05-14)
- [question-maker] frontend: Fix `question-maker-frontend#build` — add missing `tsconfig.json` and `tsconfig.node.json`; resolve all TypeScript errors from the React 19 / `moduleResolution: "bundler"` type mismatch (`React.ElementRef` → `React.ComponentRef` across all shadcn UI components, bump `@types/react` and `@types/react-dom` to v19, fix pdfjs-dist v4 import path, correct `isDraft` access path on `QuestionVariant`, and exclude stale archive and mock data files from compilation). (#133, @evanbones, 2026-05-14)
- [question-maker] backend: Fix `question-maker-backend#test` — replace hardcoded `node_modules/jest/bin/jest.js` path with a `scripts/run-jest.cjs` helper that resolves Jest via `require.resolve`, compatible with npm workspace hoisting. (#133, @evanbones, 2026-05-14)
- [ai-tutor] server: Fix `server#test` Prisma binary resolution in `test/globalSetup.js` — walk up the directory tree to find the hoisted `prisma` binary, run `prisma generate` before `prisma migrate deploy`, and handle Windows by resolving the `.cmd` wrapper and invoking via `cmd.exe /c`. (#133, @evanbones, 2026-05-14)
- [core] auth: Fix `edu-ai-core-learning#build` — remove `apiKeyClient` import from `app/lib/auth/client.ts`; not exported by `better-auth@1.2.8/client/plugins`. (#133, @evanbones, 2026-05-14)
- [ai-tutor] frontend: Fix `aitutor#test` — replace invalid `resolve.tsconfigPaths: true` with `tsconfigPaths()` plugin in `vitest.config.ts` so the `~/*` path alias resolves correctly; all 6 test files (29 tests) now pass. (#133, @evanbones, 2026-05-14)
- [monorepo] infra: Fix duplicate React installation that broke question-maker-frontend tests — loosen exact React pin in `ai-tutor` (`19.2.1` → `^19.2.1`) and bump React constraint in `edu-ai` (`^19.2.1` → `^19.2.3`) so npm deduplicates to a single React 19.2.6 at the workspace root; eliminates the two-React-instance problem that caused hook failures in jsdom tests. (#137, @evanbones @abdullahmoh21, 2026-05-15)
- [core] infra: Add `passWithNoTests: true` to `apps/core/vitest.config.ts` so `edu-ai#test` exits cleanly when no test files exist yet rather than failing the root `npm run test`. (#137, @evanbones, 2026-05-15)
- [question-maker] frontend: Remove invalid `vitest: true` ESLint env from `.eslintrc.cjs` — `vitest` is not a recognised built-in ESLint environment and caused a hard error on `npm run lint`; test files import `vi` explicitly from `vitest` so no globals env is needed. (#137, @ariqmuldi, 2026-05-15)

## [Week 1 — May 4–8, 2026]

### Added

- [monorepo] docs: Add platform centralization architecture plan for Epic #58 covering current state of all three extensions, gap analysis, API contracts, migration plan, key decisions, and known challenges. (#96, @ariqmuldi, 2026-05-10)
- [monorepo] docs: Add user management and roles architecture plan for Epic #60 covering role hierarchy, Unit concept, current permissions per role, gaps, naming decisions, and Canvas role reference. (#96, @ariqmuldi, 2026-05-10)

### Changed

- [monorepo] docs: Update platform centralization plan to reflect open PRs — EC-3 enrollment endpoint now in progress on `feature/enrollment-api`; EC-10 OAuth/OIDC sister-app auth covered by PRs #48, #49, #51, #50; Phase 1 and Week 2 checklist updated accordingly. (#96, @ariqmuldi, 2026-05-10)
- [monorepo] docs: Update user management and roles plan to reflect enrollment endpoint progress on `feature/enrollment-api`. (#96, @ariqmuldi, 2026-05-10)
- [monorepo] docs: Expand platform centralization plan with additional gaps, decisions, and corrections — corrected QM AI Chat status (question generation still calls providers directly; OCR extraction and variant generation already centralized), added gaps QM-7/QM-8/AT-3/EC-12, added within-extension cleanup section, added Decisions 5–7 (bug reporting consolidation, subdomain/cookie strategy, QM ORM), added open question on shared question bank visibility control, added out-of-scope items for unified dashboard and user navigation flow, and updated Week 2 checklist. (@abdullahmoh21, 2026-05-10)

---

## How to use this changelog

**Every PR that changes user-visible behavior, public APIs, the database schema, the build, or developer workflow must add an entry here before it is merged.** Trivial changes (typo fixes, internal refactors with no observable effect, comment-only edits) may be skipped — when in doubt, add an entry.

1. Find the section for the **current sprint / milestone** at the top under `## [Unreleased]`. If there is no open sprint section, create one (see template below).
2. Add your entry under the correct **category** (see "Categories" below).
3. Use the entry format:
   ```
   - Short, imperative description. (#PR-number, @github-handle, YYYY-MM-DD)
   ```
4. If the change is **breaking**, prefix the description with `**BREAKING:**` and add a short migration note on the next line.
5. Commit the changelog update **as part of the same PR** — do not open a separate "update changelog" PR.

When a sprint / milestone closes, the maintainer renames the section header from `[Unreleased – Sprint N]` to the final sprint name and date range, and opens a new `[Unreleased]` block at the top.

### Sprint section template

When opening a new sprint, copy this block just below the intro section:

```markdown
## [Unreleased — Sprint N]

### Added

-

### Changed

-

### Deprecated

-

### Removed

-

### Fixed

-

### Security

-
```

### Categories

Use these category headings (from Keep a Changelog) — keep them in this order, and omit any that have no entries for the sprint:

| Category       | Use for                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Added**      | New features, endpoints, components, pages, scripts, or env vars.                                         |
| **Changed**    | Updates to existing behavior, refactors with observable effects, dependency upgrades that affect runtime. |
| **Deprecated** | Features still present but scheduled for removal. Note the removal target.                                |
| **Removed**    | Features, files, branches, endpoints, or env vars that have been deleted.                                 |
| **Fixed**      | Bug fixes.                                                                                                |
| **Security**   | Vulnerability fixes, auth/permissions changes, secret-handling fixes.                                     |

### Entry format

```
- [app] scope: Short, imperative description in sentence case. (#PR, @author, YYYY-MM-DD)
```

- **App tag** is required. Use one of: `[core]`, `[ai-tutor]`, `[question-maker]`, `[monorepo]` (for root-level changes that affect the repo as a whole).
- **Scope** (optional but encouraged) — prefix after the app tag to help readers scan. Common ones: `frontend:`, `api:`, `db:`, `auth:`, `infra:`, `docs:`, `model:`, `ui:`, `content:`.
- **Imperative voice:** "Add team page route" — not "Added team page route" or "Adds team page route". The category heading already supplies the tense.
- **PR number** is required. If the change was pushed without a PR (rare — emergency hotfix only), use the commit short SHA instead: `(commit a1b2c3d, @author, YYYY-MM-DD)`.
- **Author** is the GitHub handle of the person who wrote the code, not the reviewer.
- **Date** is the merge date in `YYYY-MM-DD` (ISO 8601).
- **Breaking changes** — prefix with `**BREAKING:**` after the app tag and follow with an indented migration note:
  ```
  - [core] **BREAKING:** Rename `/api/users/me` to `/api/auth/session`. (#123, @ayyhab, 2026-05-07)
    - Migration: update all client calls; old route returns 410 Gone for one sprint, then is removed.
  ```
