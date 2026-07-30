# Design: README monorepo refresh (#815)

**Date:** 2026-07-29  
**Issue:** [#815](https://github.com/EduAI-Lab/EduAI/issues/815) — Root docs refresh for pilot  
**Status:** Approved for planning (design dialogue complete)

## Goal

Refresh README files so a new teammate can onboard against the Turborepo monorepo without tribal knowledge or contradictory install/auth/port stories.

## Explicit non-goals

- Do **not** edit `docs/ARCHITECTURE.md` (already updated).
- Do **not** edit `docs/DEPLOYMENT.md` or `TESTS.md` (out of scope for this pass).
- Do **not** refresh `packages/*`, `infra/*`, `eduai-design-system/*`, or QM `docs/deployment/README.md`.
- Do **not** require a CHANGELOG entry unless we document newly shipped behavior (we are not).
- Do **not** rewrite AGENTS.md or other non-README guides.

## Scope (file inventory)

| File | Treatment |
|------|-----------|
| `README.md` (root) | Light accuracy pass only |
| `apps/core/README.md` | Slim rewrite — drop API cookbook |
| `apps/extensions/ai-tutor/README.md` | Thin pointer rewrite |
| `apps/extensions/ai-tutor/server/README.md` | Align framing; keep useful maps |
| `apps/extensions/ai-tutor/app/README.md` | Align framing; fix stale claims |
| `apps/extensions/question-maker/README.md` | Replace JWT / Compose-primary story |
| `apps/extensions/question-maker/app/backend/README.md` | Light align (already mostly correct) |

No Question Maker frontend README exists; do not create one unless needed for a broken link.

## Approach

**Role-split rewrite** (chosen over fact-fix-in-place and template-uniform):

- Root owns platform onboarding (`npm install`, `npm run dev`, Docker DBs, ports, seeded accounts, service key).
- App / nested READMEs are **thin pointers** for getting started: they do not teach a competing primary install path.
- Core’s long endpoint cookbook is removed; point readers to `docs/ARCHITECTURE.md` (§6–7) and `apps/core/app/routes/`.

## Content rules

1. **One onboarding path** — From monorepo root: `npm install` → `npm run dev`. Optional turbo filters for single-app work. No competing “clone this app and `npm install` here” as the primary story.
2. **App READMEs own app truth only** — Purpose, stack, ports, env vars, turbo filters, directory map, auth model, links to nested READMEs / ARCHITECTURE / TESTS.
3. **Don’t invent** — Fix or delete stale directory trees and feature claims; do not expand into new documentation surfaces.
4. **Broken links** — Fix only links inside the READMEs we touch.

## Per-file change plan

### Root `README.md`

- Verify layout tree (including `example-extension` if listed).
- Verify links to extension READMEs and key docs.
- Fix only clear factual errors; leave long digressions (mobile audit, latency bench) as-is.

### `apps/core/README.md`

Rewrite to a short Core-focused doc:

- What Core is (RAG chat + central API / auth for extensions).
- Short feature summary (not the full policy registry dump unless one line each).
- **Develop from root** (pointer to root README).
- Essential env: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (**`http://localhost:3000`**, not 5173), `ENCRYPTION_KEY`, `EDUAI_API_KEY`, embedding-related vars — with pointer to `.env.example` / `docs/ENVIRONMENT.md`.
- Local scripts useful from `apps/core` (`typecheck`, `test:unit`, `db:*`) and pointer to root test commands / `TESTS.md`.
- API discovery: link to ARCHITECTURE §6–7 and `app/routes/` — **no** curl cookbook.

### `apps/extensions/ai-tutor/README.md`

- Keep tech stack, content hierarchy, roles, two-agent summary, env tables.
- Remove local `docker compose up -d db` / separate `server && npm install` as primary setup.
- Primary path: root install/dev + `npx turbo run dev --filter=ai-tutor --filter=ai-tutor-server`.
- Link to `server/README.md` and `app/README.md`.
- Fix duplicate/confusing section headings if present.

### `apps/extensions/ai-tutor/server/README.md`

- Keep directory map and request-flow / Core session auth (already accurate).
- Frame DB/dev against monorepo Docker (`docker-compose.dev.yml` / root scripts), not a standalone-first story.
- Point tests to local scripts and/or root / `TESTS.md`.

### `apps/extensions/ai-tutor/app/README.md`

- Keep useful route/component map.
- Correct stale claims (e.g. TA as hard “unsupported” if the app now uses instructor shell read-only).
- Add root-dev pointer; auth is EduAI / Core session, not a local password flow.

### `apps/extensions/question-maker/README.md`

- Auth: Core session validation — **not** JWT + bcrypt as the platform auth story.
- Primary path: monorepo root `npm run dev` (ports 5173 / 8000).
- Demote `npm run dev:up` / local Compose to optional alternate.
- Keep campus vLLM defaults section and docs index table.
- Align tech stack row with Prisma + Core session.

### `apps/extensions/question-maker/app/backend/README.md`

- Light pass: ensure install/env language matches root-first; keep accurate Core-session auth description.

## Verification

- Manually open each touched README and follow every relative link.
- Grep touched files for stale markers: `JWT`, `5173` as Core URL, `docker compose up -d db` as primary, `BETTER_AUTH_URL=.*5173`.
- Spot-check ports against root README table (3000 / 3001 / 4000 / 5173 / 8000).

## Done criteria

- [ ] New teammate path: root → app README → nested README has no contradictory install/auth/port stories.
- [ ] Core README no longer documents Core as Vite-on-5173 or ships a long API curl cookbook.
- [ ] QM top-level README no longer lists JWT+bcrypt as auth.
- [ ] AI Tutor top-level README’s primary path is monorepo root + turbo filters.
- [ ] `ARCHITECTURE.md`, `DEPLOYMENT.md`, `TESTS.md` untouched.

## Implementation next step

After this spec is approved, produce an implementation plan via the writing-plans skill and execute file-by-file edits on branch `docs/root-doc-cleanup`.
