# #1041 — Server-side pagination for Core admin list APIs

Branch: `feat/1041-server-side-admin-pagination` off `origin/development` (f5c866bb)
Related: #1125 (batch-by-id + search, prerequisite), #1143 (searchable course
pickers, also closed here), #1045 (parent), #944, #1043, #1044

## Decisions

- **TanStack `manualPagination`** on the frontend, not the loader/searchParams style used by `admin.logs.tsx`.
- **`page`/`pageSize` are required.** No legacy full-list fallback. Missing or invalid params return 400.
- **Every reader migrates in this PR**, including the ones in `apps/extensions/*`. Breaking change; extensions must land with Core.
- **#1125 lands first or alongside.** Without `?ids=` and `?search=`, four call sites can only page-loop, which is strictly worse than today.

## Response shape

All four endpoints converge on one envelope, replacing today's mix of bare arrays and `{ courses }`:

```json
{ "data": [...], "total": 0, "page": 1, "pageSize": 25 }
```

`normalizePagination` clamps `page >= 1` and `pageSize` to 1..200.

## Slices

### 1. Shared pagination helper
Extract `normalizePagination` from `apps/core/app/lib/db.auditlog.server.ts:64` into `apps/core/app/lib/pagination.server.ts`, plus `parsePaginationParams(request)` that throws a 400 when `page`/`pageSize` are absent or unparseable. Point `db.auditlog.server.ts` and `db.systemlog.server.ts` at the shared helper (they keep their current defaults — the logs routes supply the params).

### 2. Core server endpoints
Each becomes `prisma.$transaction([count({ where }), findMany({ where, orderBy, skip, take })])`.

- `app/lib/api/users-api.server.ts:63` — also re-scope the TA `enrollment.findMany` at `:86` to the current page's user ids, otherwise the second query stays unbounded.
- `app/lib/api/ai-models-api.server.ts:48`
- `app/lib/api/ai-providers-api.server.ts:44` — the nested `models` include is unbounded per provider; drop to `_count` or bound it.
- `app/lib/courses/server.ts:167` (session path) and `:148` (service-key path).
- Leave `app/lib/courses/server.ts:571` `getAccessibleCourseCodes` unpaginated — internal RBAC helper, not an endpoint.

### 3. Lookup surfaces (#1125)
`?ids=` on `/api/users` and `/api/courses`, `?search=`/`?role=` on `/api/users`, `?search=` on `/api/courses`. `ids` and `page` are mutually exclusive.

### 4. Core frontend
- Hooks take page state and pass params: `app/hooks/api/use-users.ts:18`, `use-courses.ts:45`, `use-ai-models.ts:14`, `use-ai-providers.ts:21`.
- `app/components/admin/users-table.tsx:367` — add `manualPagination`, `manualSorting`, `manualFiltering`, `rowCount`; drop `getPaginationRowModel`/`getSortedRowModel`/`getFilteredRowModel`. Role facets at `:388` come from the server, not `getFacetedUniqueValues()`.
- `app/components/admin/ai-models-table.tsx:87` and `providers-table.tsx` have no pagination at all today — add controls.
- `app/components/admin/users-admin-view.tsx:96` computes total and active-user counts from `users.length`; both must come from the API.
- `app/components/layout/course-switcher.tsx:30` and `app/components/command/command-palette.tsx:102` switch to server-side search.
- Dashboard views (`dashboard-{admin,instructor,ta,student,unit-admin}-view.tsx`) aggregate over the full course array — need server-side counts.

### 5. AI Tutor consumers
- `server/src/services/eduaiClient.js` — `listEduAiCourses:223`, `listEduAiCoursesServiceKey:260`, `findEduAiCourseById:239` (switch to lookup-by-id), `listCoreAdminUsers:148`, `listEduAiAiModels:322` (currently `if (!Array.isArray(data)) throw`).
- `server/src/services/courseResolver.js:59-93`.
- `server/src/routes/admin.js:51,154,581` and `server/src/routes/courses.js:1074` — replace full-table id->name maps with `?ids=`.
- Update `EduAiCourseListSchema`.

### 6. Question Maker consumers
- `app/backend/src/services/coreApiService.js:212,222,271`
- `app/backend/src/services/courseListService.js:115,195,250,345`
- `app/backend/src/services/eduaiService.js:786,899` (dual-shape handling can collapse to one shape)
- `app/backend/src/routes/eduai.js:184,288` and `app/frontend/src/services/eduaiService.ts:203,232`

### 7. Example extension + docs
- `apps/extensions/example-extension/src/server.js:96`
- `docs/EXTENSION_ONBOARDING.md:213`

### 8. Contracts and tests
- `apps/core/app/lib/agent-readiness/manifest.ts:193,492` — declare the new params; `tests/integration/agent-readiness.integration.test.ts` validates it.
- `apps/core/app/tests/unit/use-users.test.ts:56` pins the exact `apiFetch("/api/users")` URL — will break, update.
- `tests/integration/service-key.integration.test.ts` and `courses.integration.test.ts` assert the current contract.
- New coverage: 400 on missing params, page clamping, `total` correctness, `ids` + `page` conflict, TA-enrollment scoping on the users page.
- AI Tutor `server/tests/integration/*` and QM backend tests that stub Core responses.

## Estimate

~16-20h, versus the issue's 6 — the estimate assumed a Core-only change. Suggest splitting delivery as **1041a** (Core API + Core UI) and **1041b** (extension migration), landing together in one PR or back-to-back so extensions never run against a shape they don't understand.

---

## Implementation notes (as landed)

### What the wire looks like now

`GET /api/users`, `/api/courses`, `/api/ai-models`, `/api/ai-providers` all require
`page`/`pageSize` (400 `PAGINATION_REQUIRED` otherwise) and answer with
`{ data, total, page, pageSize }`. `pageSize` clamps to 1..200. `GET /api/users`
also carries `stats: { total, active, byRole }` — platform-wide counts that do
not move with the caller's filters, added because several dashboards derived
those numbers by counting a full list.

Lookup surfaces (#1125): `?ids=` on `/api/users` and `/api/courses` (unpaged,
mutually exclusive with paging, capped at 200 ids), `?search=` on both,
plus `?role=`/`?isActive=`/`?sortBy=`/`?sortDir=` on users and
`?search=`/`?providerId=` on ai-models.

### Deviations from the plan

- **`/api/ai-providers` dropped its nested `models` array** rather than bounding
  it. Every caller only reads `_count.models`, so the include was pure waste.
- **Some flows page-walk instead of using `?ids=`.** Three reads genuinely need a
  complete set and have no id list to narrow with: AI Tutor's
  `resolveCoreCourseCatalog` (`/admin/courses` materializes a local anchor per
  Core course), QM's `getAllCoursesFromCore` for the ADMIN list (same reason),
  and the import/auth flows that reconcile against every course a caller can
  see. These now walk pages explicitly (`all: true`, capped at 50 pages) instead
  of issuing one unbounded request. Everything that *does* know its ids —
  `findEduAiCourseById`, the admin id→name user maps, QM's
  `enrichRowsWithCourse` and non-ADMIN `listCoursesForUser`,
  `isCoreCourseInScopedList` — uses `?ids=`, and
  `findCoursesByProjectedCode` uses `?search=`.
- **Course pickers take one bounded page** (`pageSize=200`) instead of the
  unbounded read. Two of them then gained server-side search on top of that page
  (#1143, closed by this PR): the breadcrumb **course switcher** and the **⌘K
  command palette** both debounce the typed query 300ms and re-query
  `/api/courses?...&search=` rather than filtering the page in memory — without
  it neither could ever reach a course past the first 200. The palette drives
  this through `@eduai/ui`'s `CommandPalette`, which gained an `onQueryChange`
  callback and `shouldFilter={false}` so cmdk's client-side filter doesn't
  re-filter server-matched rows out of the DOM. A failed search request keeps the
  current list rather than blanking it.

  The remaining two pickers — the chat course picker
  (`chat-screen.tsx:69`) and the user form's course selector
  (`users-admin-view.tsx:52`) — still take one bounded page with no search. Both
  are dialog-scoped selects rather than jump-to-anything surfaces, so the same
  UX argument doesn't apply; adding search there is a separate change.
- **`users-table.tsx` keeps its filter state locally** and reports a single
  `UsersQuery` upward (debounced 300ms). TanStack still owns the control state,
  so the existing filter/sort/pager UI is untouched; only the row models changed.
- **The `activity` column is no longer sortable** — it is derived from per-row
  counts and Postgres cannot order by it.
- **`getCourses` authenticates before parsing params**, so an anonymous caller
  still gets 401 rather than a 400 describing the endpoint's query contract.
- **The unit-admin branch of `/courses` no longer re-filters by department**
  client-side; Core already scopes UNIT_ADMIN, and filtering a page would
  silently drop rows.

### Verification

- Core: 2036/2036 unit tests pass. 26 test *files* fail to collect in this
  worktree because `better-auth`, `@ai-sdk/react`, and friends are not installed
  here — pre-existing, unrelated to this change.
- AI Tutor server: 308/308 pass (3 files fail to collect: missing `supertest`).
- Question Maker backend: 222/222 pass (26 files fail to collect: missing
  `sequelize`).
- `tsc --noEmit` reports no errors in any file this change touches.
- Integration tests were updated for the new contract but **not executed** — they
  need a live Postgres, which was not available here.
