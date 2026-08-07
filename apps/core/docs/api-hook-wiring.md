# API hook wiring (Person B — platform hooks)

Central reference for `app/hooks/api/*`: live Core endpoints vs stubs.  
Course hooks (`use-course*`) are owned by Person A — see their PR description.

**Config:** `app/hooks/api/config.ts` — `apiFetch`, `STUB_ONLY`, `ApiError`

---

## Platform hooks (Person B)

| Hook | Owner | Live? | Endpoint / method | Gap / issue |
|------|-------|-------|-------------------|-------------|
| `useUsers` | B | **Yes** | `GET/POST /api/users`, `PATCH/DELETE /api/users/:id` | Includes validated `authorizedUnits` assignment for `UNIT_ADMIN` users |
| `useAiProviders` | B | **Yes** | `GET/POST /api/ai-providers`, `PATCH/DELETE /api/ai-providers/:id` | ADMIN-only on API |
| `useAiModels` | B | **Yes** | `GET/POST /api/ai-models`, `PATCH/DELETE /api/ai-models/:id` | ADMIN-only on API |
| `useChatSession` | B | **Yes** | `GET/DELETE /api/chats/:chatId` | `DELETE` live (#302); no course-scoped list |
| `fetchChatSession` | B | **Partial** | `GET /api/chats/:chatId` | No course-scoped list |
| `useBugReports` | B | **Yes** | `GET /api/admin/bug-reports`, `PATCH /api/admin/bug-reports/:id` | Live since #650 (#304) |
| `useSubmitBugReport` | B | **Yes** | `POST /api/bug-reports` | Live since #650 (#304) |

---

## Course hooks (Person A — import only)

| Hook | Owner | Live? | Notes |
|------|-------|-------|-------|
| `useCourses` | A | Yes | Chat course picker imports this — do not duplicate |
| `useCourseEnrollments` | A | **Yes** | `GET/POST /api/courses/:id/enrollments`, `PATCH/DELETE .../:enrollmentId` (#305, #551) |
| `useCourseMaterials` | A | Yes | `GET/POST /api/courses/:id/materials`, `DELETE .../:materialId` live (#300) |
| `useCourseTopics` | A | Yes | PATCH stub #299 |

---

## `STUB_ONLY` flags (`config.ts`)

All flags are currently `false` — every hook below is live. Kept only as kill-switches.

| Flag | Current | When true |
|------|---------|-----------|
| `bugReports` | `false` | Bug list + submit use fixtures |
| `deleteChat` | `false` | `deleteChatSession` logs warning, no API call |

`useCourseMaterials` no longer exports a local `STUB_ONLY` — `deleteMaterial` is unconditionally live (#300).

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
