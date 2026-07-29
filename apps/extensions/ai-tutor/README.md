# AI Tutor

Two-agent tutoring extension (primary tutor + pedagogical reviewer) with hierarchical course content (CourseOffering → Module → Lesson → Activity). Session auth is **delegated to EduAI Core** — this app has no local password/JWT login.

## Develop from the monorepo root

```bash
# from repo root
npm install
npm run dev
# AI Tutor only (frontend + API):
npx turbo run dev --filter=ai-tutor --filter=ai-tutor-server
```

| Process | URL |
|---------|-----|
| Frontend | http://localhost:3001 |
| API server | http://localhost:4000 |

Databases: use root Docker Compose (`npm run docker:dev:db` / `npm run dev`), not a separate AI-Tutor-only Compose as the primary path. Details: [root README](../../../README.md).

Nested docs:

- [Frontend (`app/`)](app/README.md)
- [Backend (`server/`)](server/README.md)

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React Router v7 (SPA), Vite, Tailwind v4, `@eduai/ui` |
| Backend | Express 5, Prisma, PostgreSQL |
| Auth | Core `POST /api/sessions/validate` (cookie forwarded) |
| AI | Tutor/supervisor loops via Core `/api/completion` (service key) |

## Content hierarchy

CourseOffering → Module → Lesson → Activity

Unpublished parents hide children. Topics scoped per CourseOffering.

## Roles (summary)

STUDENT, TA (instructor shell read-only; student surfaces where allowed), INSTRUCTOR, UNIT_ADMIN, ADMIN — see [docs/implementations/rbac-matrix.md](../../../docs/implementations/rbac-matrix.md) and [app/lib/rbac/permissions.ts](app/lib/rbac/permissions.ts)

## Environment

Server (`server/.env`): `DATABASE_URL`, `CORE_URL`, `EDUAI_API_KEY`, `EDUAI_BASE_URL`, `PORT` default 4000

Frontend Vite: `VITE_API_URL` default 4000, `VITE_EDUAI_URL` 3000, `VITE_QUESTION_MAKER_URL` 5173

## Scripts

Prefer root/turbo. Package-local: `npm run dev` (FE 3001), `test`; server `npm run dev` (4000), `test`/`unit`/`integration`. See [TESTS.md](../../../TESTS.md).

## Related

- [Root README](../../../README.md), [ARCHITECTURE.md §8–9](../../../docs/ARCHITECTURE.md)
- [Two-agent supervisor system](docs/two-agent-supervisor-system.md)
