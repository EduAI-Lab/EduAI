# Repository Guidelines

## Project Structure and Module Organization

- `app/` hosts the React Router v7 client (SPA mode, `ssr: false`). `app/routes.ts` maps flat routes under `app/routes/`, powering `home.tsx` for EduAI OAuth login, `student.*.tsx` dashboards, `instructor.*.tsx` authoring screens, and `admin.tsx` for system management. Better Auth session state is managed in `app/hooks/useLocalUser.tsx`, shared UI in `app/components/` (including `StudentAiChat.tsx`, `ActivityDetailsCard.tsx`, guided tour components), helpers in `app/lib/`, and Tailwind v4 utilities in `app/app.css`; `app/root.tsx` renders the HTML shell with Auth, BugReport, and Tour providers.
- `server/` is the Express 5 API (`src/index.js`) with Better Auth + EduAI OAuth config in `src/auth.js`, session middleware in `src/middleware/`, route handlers in `src/routes/` (11 route files), business logic in `src/services/` (AI guidance, analytics, cloning, enrollment sync, topic sync, model policy, bug reports), and response mappers in `src/utils/`. Prisma schema, migrations, and seeds live under `prisma/`.
- `shared/schemas/` contains Zod validation schemas (`activity.js`, `aiGuidance.js`) shared between frontend and backend.
- `public/` holds static assets; builds land in `build/client` only (SPA mode). Configs (`vite.config.ts`, `react-router.config.ts`, `tsconfig.json`) coordinate Tailwind, SPA builds, and the `~/` alias.

## Build, Test, and Development Commands

- Use Bun for all scripts locally (`bun install`, `bun run`, and `bunx`).
- `bun run dev` — Vite dev server at `http://localhost:5173` with hot reload.
- `cd server && bun run dev` — Express API with nodemon on port 4000.
- `cd server && bunx prisma migrate deploy` — apply migrations.
- `cd server && bun run seed` — reset and seed demo data after schema updates (destructive).
- `bun run build` — build SPA assets into `build/client`.
- `bun run start` — preview the built SPA with `vite preview --outDir build/client`.
- `bun run typecheck` — regenerate React Router types and run `tsc`.
- `bun run typecheck:fast` — regenerate types and run `tsgo` (~10x faster).
- `bun run lint` / `bun run lint:fix` — lint with oxlint.
- `bun run format` / `bun run format:check` — format with oxfmt.
- `bun run knip` — dead code detection.
- `bun run test` — frontend tests (Vitest with jsdom).
- `cd server && bun run test` — backend tests (Vitest with supertest).
- `cd server && bun run test:unit` / `bun run test:integration` — scoped test runs.

## Coding Style and Naming Conventions

- TypeScript strict mode, 2-space indentation, and Tailwind-first styling. Components PascalCase, hooks camelCase, route modules lowercase with dots (`instructor.list.tsx`), Prisma models PascalCase.
- Format rules (oxfmt): print width 100, semicolons, single quotes, trailing commas.
- Keep `app/lib/api.ts` aligned with backend mappers in `server/src/utils/mappers.js`.
- Preserve cookie-session semantics (`credentials: "include"`) when touching auth-related client code.
- For route protection, use `requireClientUser(role)` on the frontend and `requireAuth`/`requireRole`/`requireRoles` on the backend.
- Keep business logic in `server/src/services/`; route handlers should orchestrate, not compute.
- Validate request bodies with Zod schemas from `shared/schemas/`.

## Testing Guidelines

- Frontend: `bun run test` runs Vitest with jsdom. Tests in `app/__tests__/` and co-located (e.g., `tour-engine.test.ts`).
- Backend: `cd server && bun run test` runs Vitest with supertest. Tests in `server/test/unit/` and `server/test/integration/`. Uses mock auth via `createApp({ mockUser })`.
- Current verification baseline: `bun run typecheck`, `bun run test`, `cd server && bun run test`.
- Add regression tests when changing auth, role gating, cloning, or AI guidance logic.
- Test API endpoints with both authorized and unauthorized users.

## Pre-Commit Hook

The `.githooks/pre-commit` hook runs scoped checks on staged files:
- Format check (oxfmt) on staged source files.
- Lint (oxlint) on staged source files.
- Typecheck (tsgo) if `.ts`/`.tsx` files are staged.
- Backend tests (vitest `--changed`) if `server/` files changed.
- Frontend tests (vitest `--changed`) if `app/`/`shared/` files changed.

## Commit and Pull Request Guidelines

- Use Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `perf:`). Keep subjects imperative and under 72 chars.
- PRs should outline scope, affected routes or endpoints, manual verification, and linked issues. Attach screenshots or GIFs for UI work and flag migrations or seed updates.

## Environment and Configuration Tips

- Client reads `VITE_API_URL` (default `http://localhost:4000`).
- Server uses `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `COOKIE_DOMAIN`, EduAI OAuth vars (`EDUAI_DISCOVERY_URL`, `EDUAI_CLIENT_ID`, `EDUAI_CLIENT_SECRET`, `EDUAI_USERINFO_URL`), `EDUAI_BASE_URL`, `EDUAI_API_KEY`, `EDUAI_MODEL` in `server/.env`.
- `BETTER_AUTH_URL` defaults to `http://localhost:4000/api/auth` and `EDUAI_BASE_URL` defaults to `http://localhost:5174/api` when unset.
- Ensure Postgres is running before migrations or seeds.
- After modifying Tailwind, routing, or the Prisma schema, rerun `bun run typecheck` and refresh seeds to keep generated artifacts aligned.
- Auth is EduAI OAuth (OIDC + PKCE), not email/password. No JWT or bearer tokens.
