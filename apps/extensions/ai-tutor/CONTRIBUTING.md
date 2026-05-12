# Contributing to AiTutor

## Getting Started

1. Clone the repository and follow the [Local Setup](README.md#local-setup) instructions.
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. Run the verification baseline before starting:
   ```bash
   bun run typecheck
   bun run test
   cd server && bun run test
   ```

## Development Workflow

### Two-Terminal Setup

```bash
# Terminal 1: Backend (port 4000)
cd server && bun run dev

# Terminal 2: Frontend (port 5173)
bun run dev
```

### After Schema Changes

If you modify `server/prisma/schema.prisma`:

```bash
cd server
bunx prisma migrate dev --name description_of_change
bun run seed   # Warning: destructive, clears all data
cd ..
bun run typecheck
```

### After Route Changes

If you modify `app/routes.ts`, run `bun run typecheck` to regenerate React Router types.

## Code Style

### General

- **TypeScript strict mode** with 2-space indentation.
- **Tailwind-first** styling; avoid inline CSS or CSS modules.
- **ESM** throughout (`"type": "module"` in both `package.json` files).

### Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Components | PascalCase | `StudentAiChat.tsx` |
| Hooks | camelCase with `use` prefix | `useLocalUser.tsx` |
| Route modules | lowercase with dots | `instructor.list.tsx` |
| Prisma models | PascalCase | `CourseOffering` |
| API endpoints | kebab-case | `/api/ai-models/validate-key` |
| Backend files | camelCase | `aiGuidance.js` |

### Frontend Patterns

- Keep `app/lib/api.ts` request/response shapes aligned with `server/src/utils/mappers.js`.
- Preserve cookie-session semantics (`credentials: "include"`) in all API calls.
- Use `requireClientUser(role)` in `clientLoader` functions for route protection.
- Prefer `useOptimistic` (React 19) for instant UI feedback on mutations.
- Use shadcn/ui primitives from `app/components/ui/` for consistent UI.

### Backend Patterns

- Use `requireAuth`, `requireRole`, or `requireRoles` middleware for route protection.
- Validate request bodies with Zod schemas from `shared/schemas/`.
- Use response mappers from `server/src/utils/mappers.js` for consistent API shapes.
- Keep business logic in `server/src/services/`; routes should orchestrate, not compute.

## Linting and Formatting

The project uses [oxlint](https://oxc.rs/docs/guide/usage/linter) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) for fast linting and formatting.

```bash
# Lint
bun run lint          # Check for issues
bun run lint:fix      # Auto-fix

# Format
bun run format        # Format files
bun run format:check  # Check without modifying
```

Configuration files: `.oxlintrc.json` and `.oxfmtrc.json` in the project root.

### Format Rules

- Print width: 100
- 2 spaces, no tabs
- Semicolons, single quotes, trailing commas

## Testing

### Frontend Tests

```bash
bun run test              # All frontend tests
bun run test:watch        # Watch mode
bun run test:frontend     # Frontend only
```

- **Runner**: Vitest with jsdom environment
- **Libraries**: `@testing-library/react`, `@testing-library/jest-dom`
- **Location**: `app/__tests__/` (mirrors `app/` structure)
- **Co-located tests**: Some test files live next to source (e.g., `tour-engine.test.ts`)

### Backend Tests

```bash
cd server
bun run test              # All backend tests
bun run test:unit         # Unit tests only
bun run test:integration  # Integration tests only
```

- **Runner**: Vitest with supertest for HTTP assertions
- **Location**: `server/test/unit/` and `server/test/integration/`
- **Test DB**: Uses `.env.test` (database `aitutor_test`, port 4001)
- **Mock auth**: `createApp({ mockUser })` bypasses Better Auth

### What to Test

- Add regression tests when changing auth, role gating, or cloning logic.
- Test API endpoints with both authorized and unauthorized users.
- Test frontend components that manage complex state (forms, AI chat, tours).

### Dead Code Detection

```bash
bun run knip
```

Uses [Knip](https://knip.dev/) to find unused exports, dependencies, and files.

## Pre-Commit Hook

The `.githooks/pre-commit` hook runs automatically and scopes checks to staged files:

| Check | Trigger | Tool |
|-------|---------|------|
| Format | Any staged source file | oxfmt `--check` |
| Lint | Any staged source file | oxlint `--quiet` |
| Typecheck | Any `.ts`/`.tsx` file staged | tsgo `--noEmit` |
| Backend tests | `server/` files staged | vitest `--changed HEAD` |
| Frontend tests | `app/`/`shared/` files staged | vitest `--changed HEAD` |

To skip in exceptional cases: `git commit --no-verify` (avoid this).

## Git Hooks & Tooling Dependencies

The repository ships hook scripts under [`.githooks/`](.githooks/). They are **not** active by
default after a fresh clone — Git only runs them once you point `core.hooksPath` at the
directory:

```bash
git config core.hooksPath .githooks
```

Run that once per checkout. Verify with `git config core.hooksPath` (should print `.githooks`).

### Hook inventory

| Hook | Purpose | External dependency |
|------|---------|---------------------|
| `pre-commit` | Scoped lint / format / typecheck / tests on staged files (`oxfmt --check`, `oxlint --quiet`, `tsgo --noEmit`, `vitest --changed HEAD`). Skip with `--no-verify`. | `npx`-resolvable tools from `devDependencies` only. |
| `prepare-commit-msg` | Inserts/condenses an `Entire-Checkpoint` trailer if the current shell is inside an Entire CLI session. | **`entire` binary in `$PATH`** |
| `commit-msg` | Validates the commit message and strips the auto-trailer when there is no real user content (allows aborting empty commits). Hard-fails the commit if the script errors. | **`entire` binary in `$PATH`** |
| `post-commit` | Condenses session data when the commit carries an `Entire-Checkpoint` trailer. Soft-failing (`|| true`). | **`entire` binary in `$PATH`** |
| `pre-push` | Pushes session logs alongside the user's `git push`. Soft-failing (`|| true`). | **`entire` binary in `$PATH`** |

### What "requires `entire`" actually means

`commit-msg`, `prepare-commit-msg`, `post-commit`, and `pre-push` shell out to the
[Entire CLI](https://entire.ai) binary. If `entire` is not installed and on `$PATH`:

- **`commit-msg` will fail.** `entire hooks git commit-msg "$1" || exit 1` aborts the commit.
  Every `git commit` becomes impossible until you either install `entire`, point
  `core.hooksPath` away from `.githooks`, or use `--no-verify`.
- **`pre-push` is soft (`|| true`)** but will print noisy "command not found" output on every
  push.
- `prepare-commit-msg` and `post-commit` are silent (both end in `|| true` and route stderr to
  `/dev/null`).

Install Entire CLI before enabling hooks, or accept that you will need `--no-verify` for every
commit.

### `.entire/` directory

The `.entire/` directory at the repo root is **session data for the Entire CLI**, not source
code. It is created and managed by the `entire` binary and the hooks above. Do not hand-edit it.
It is included in the repo's tracked tree intentionally so that session checkpoints survive
across machines.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
```

### Types

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring (no behavior change) |
| `chore` | Build, tooling, dependency updates |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `perf` | Performance improvement |

### Examples

```
feat: add activity feedback rating system
fix: prevent duplicate enrollment on sync
refactor: extract publish cascade into shared service
docs: update API reference with bug report endpoints
test: add integration tests for topic remapping
chore: upgrade Vite to v8 with Rolldown bundler
```

Keep subjects imperative mood, under 72 characters.

## Pull Requests

### PR Title

- Keep under 70 characters.
- Use the same Conventional Commit prefix as the primary commit.

### PR Description

Include:

1. **Summary** (1-3 bullet points): What changed and why.
2. **Test plan**: How to verify the change works.
3. **Affected areas**: List routes, endpoints, or components touched.
4. **Screenshots/GIFs**: Required for UI changes.
5. **Migration notes**: Flag if the PR includes schema migrations or seed updates.

### Template

```markdown
## Summary
- <What changed and why>

## Test plan
- [ ] <Manual or automated verification steps>

## Notes
- <Migrations, breaking changes, or deployment considerations>
```

## Project Structure Reference

| Directory | Purpose |
|-----------|---------|
| `app/routes/` | React Router v7 route modules |
| `app/components/` | Shared React components |
| `app/hooks/` | React context providers and custom hooks |
| `app/lib/` | API client, auth utilities, type definitions |
| `app/lib/tours/` | Guided tour engine and definitions |
| `app/components/ui/` | shadcn/ui primitives |
| `app/__tests__/` | Frontend test files |
| `server/src/routes/` | Express route handlers |
| `server/src/services/` | Business logic (AI, analytics, cloning, sync) |
| `server/src/middleware/` | Auth and session middleware |
| `server/src/utils/` | Response mappers |
| `server/src/config/` | Database client, admin bootstrap |
| `server/prisma/` | Schema, migrations, seed |
| `server/test/` | Backend test files |
| `shared/schemas/` | Zod validation schemas (used by both) |
| `docs/` | Design documents |
| `scripts/` | E2E and automation scripts |
