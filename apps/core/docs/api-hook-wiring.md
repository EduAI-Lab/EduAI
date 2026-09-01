# API hook wiring

Reference for `app/hooks/api/*`: every hook and the Core endpoint(s) it
calls. All hooks below are live against real Core routes — there are no
stubbed hooks left in the codebase (`STUB_ONLY` flags in `config.ts` all
resolve to `false`).

**Config:** `app/hooks/api/config.ts` — `apiFetch`, `STUB_ONLY`, `ApiError`.

## Hooks

| Hook | File | Endpoint(s) | Notes |
|------|------|-------------|-------|
| `useCourses` | `use-courses.ts` | `GET/POST /api/courses`, `PATCH/DELETE /api/courses/:id`, `GET /api/courses/facets` | Server-side pagination and filtering |
| `useCourseDetail` | `use-course-detail.ts` | (consumes route loader data) | No direct fetch |
| `useCourseMaterials` | `use-course-materials.ts` | `GET/POST /api/courses/:id/materials`, `DELETE .../:materialId` | Upload is async (202 + poll); server-side duplicate detection |
| `useCourseTopics` | `use-course-topics.ts` | `GET/POST/DELETE /api/courses/:id/topics`, `PATCH .../:topicId` | |
| `useTopicAnalysis` | `use-topic-analysis.ts` | `GET/POST /api/courses/:id/topic-analysis` | Drives automatic topic provisioning (#1624) |
| `useCourseEnrollments` | `use-course-enrollments.ts` | `GET/POST /api/courses/:id/enrollments`, `PATCH/DELETE .../:enrollmentId` | No stub gate |
| `useCourseTAs` | `use-course-tas.ts` | `GET/POST/DELETE /api/courses/:id/tas` | |
| `useCourseChats` / `useUnitChats` / `useChatDetail` | `use-course-chats.ts` | `GET /api/courses/:id/chats`, `GET /api/units/:dept/chats`, `GET /api/chats/:id` (cursor-paginated) | |
| `useChatHistory` / `fetchChatTranscript` | `use-chat-history.ts` | `GET /api/chats`, `GET /api/chats/:id/messages` | |
| `useChatSession` / `fetchChatSession` | `use-chat-sessions.ts` | `GET /api/chats/:id`, `DELETE /api/chats/:id` | |
| `useUsers` / `fetchUsersByIds` | `use-users.ts` | `GET/POST /api/users`, `PATCH/DELETE /api/users/:id` | Includes `authorizedUnits` assignment for `UNIT_ADMIN` |
| `useStudentCandidates` | `use-student-candidates.ts` | `GET /api/users` (search) | |
| `useAiProviders` | `use-ai-providers.ts` | `GET/POST /api/ai-providers`, `PATCH/DELETE .../:id` | ADMIN-only on the API |
| `useAiModels` / `fetchModelsByProvider` | `use-ai-models.ts` | `GET/POST /api/ai-models`, `PATCH/DELETE .../:id` | ADMIN-only on the API; server-paginated (#1041) |
| `useRoutingModelSettings` | `use-routing-model-settings.ts` | `GET/PATCH /api/routing-model-settings` | Auto / Auto (rules) toggles |
| `useBugReports` | `use-bug-reports.ts` | `GET /api/admin/bug-reports`, `GET/PATCH .../:id` | |
| `useSubmitBugReport` | `use-submit-bug-report.ts` | `POST /api/bug-reports` | |
| `usePolicies` | `use-policies.ts` | `GET/PATCH /api/policies` | |
| `useDisciplines` | `use-disciplines.ts` | `GET /api/disciplines` | |
| `useCronJobStatuses` | `use-cron-job-status.ts` | `GET /api/admin/cron-jobs` | |

## `STUB_ONLY` flags (`config.ts`)

Both flags exist as kill-switches but are `false` today, so every hook above
hits its real endpoint:

| Flag | Current |
|------|---------|
| `bugReports` | `false` |
| `deleteChat` | `false` |

`fixtures/courses/enrollments.ts` and `fixtures/platform/bug-reports.ts` are
dead code paths kept for the (currently unused) stub fallback — nothing on a
live code path imports them.

## Usage in routes

```tsx
// Route: auth loader only
const { users, createUser, ... } = useUsers();
return <UsersAdminView users={users} onCreateUser={createUser} ... />;
```

Views must not call `fetch` directly.

## Permission layer

Access checks for what a hook's caller is allowed to do live in
`app/lib/rbac/permissions.ts` (`canX()` functions) and
`app/lib/rbac/resolve-course-access.server.ts` — not in the hooks
themselves. See that directory for the current permission matrix; it is not
duplicated here.

## Related docs

- [chat-history.md](./chat-history.md)
