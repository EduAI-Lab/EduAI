# API hook wiring (Person B — platform hooks)

Central reference for `app/hooks/api/*`: live Core endpoints vs stubs.  
Course hooks (`use-course*`) are owned by Person A — see their PR description.

**Config:** `app/hooks/api/config.ts` — `apiFetch`, `STUB_ONLY`, `ApiError`

---

## Platform hooks (Person B)

| Hook | Owner | Live? | Endpoint / method | Gap / issue |
|------|-------|-------|-------------------|-------------|
| `useUsers` | B | **Yes** | `GET/POST /api/users`, `PATCH/DELETE /api/users/:id` | No `authorizedUnits` until schema #297 |
| `useAiProviders` | B | **Yes** | `GET/POST /api/ai-providers`, `PATCH/DELETE /api/ai-providers/:id` | ADMIN-only on API |
| `useAiModels` | B | **Yes** | `GET/POST /api/ai-models`, `PATCH/DELETE /api/ai-models/:id` | ADMIN-only on API |
| `useChatSession` | B | **Partial** | `GET /api/chats/:chatId` | No `DELETE` chat (#302); no course-scoped list |
| `fetchChatSession` | B | **Partial** | `GET /api/chats/:chatId` | Same as above |
| `useBugReports` | B | **Stub** | — | Core API #304; uses `fixtures/platform/bug-reports.ts` |
| `useSubmitBugReport` | B | **Stub** | — | Core API #304 |

---

## Course hooks (Person A — import only)

| Hook | Owner | Live? | Notes |
|------|-------|-------|-------|
| `useCourses` | A | Yes | Chat course picker imports this — do not duplicate |
| `useCourseEnrollments` | A | **Yes** | `GET/POST /api/courses/:id/enrollments`, `PATCH/DELETE .../:enrollmentId` (#305, #551) |
| `useCourseMaterials` | A | Yes | DELETE stub #300 |
| `useCourseTopics` | A | Yes | PATCH stub #299 |

---

## `STUB_ONLY` flags (`config.ts`)

| Flag | When true |
|------|-----------|
| `bugReports` | Bug list + submit use fixtures |
| `deleteChat` | `deleteChatSession` logs warning, no API call |

---

## Usage in routes (target)

```tsx
// Route: auth loader only
const { users, createUser, ... } = useUsers();
return <UsersAdminView users={users} onCreateUser={createUser} ... />;
```

Views must not call `fetch` directly.

---

## Person B deliverables checklist

| Area | Status |
|------|--------|
| Platform hooks (`use-users`, AI, chat sessions, bug stubs) | Done |
| Admin users / AI models views | Done |
| Dashboard views (×5) | Done |
| Chat global + course-scoped views | Done |
| Settings view | Done |
| Bug submit dialog + admin bug reports | Done (stub) |
| Sidebar via `getNavForUser` | Done |
| Tests: AppSidebar, BugReports, ChatViews | Done |

---

## Related docs

- [RBAC_UI_TWO_PERSON_ASSIGNMENT.md](./RBAC_UI_TWO_PERSON_ASSIGNMENT.md)
- [rbac-matrix.md](../../../docs/implementations/rbac-matrix.md) §4, §10–13
- [chat-history.md](./chat-history.md)
