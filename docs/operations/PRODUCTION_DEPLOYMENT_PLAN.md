# EduAI production deployment plan

**Status:** In progress  
**Started:** 2026-08-11  
**Release branch:** `main`  
**Planning branch:** `codex/production-deployment`

## Confirmed production scope

- Core production URL: `https://my.eduai.ok.ubc.ca`
- Question Maker remains at `https://questionmaker.ok.ubc.ca/` for now.
- AI Tutor remains at `https://aitutor.ok.ubc.ca/` for now.
- The first production release is Core-only.
- Production databases are currently down and must be provisioned before go-live.
- Core will initially use `cmps01`; `cmps02` and `cmps03` will be added after firewall access is available.
- Production releases will come from `main`.

## Authentication/domain dependency

The current Core authentication design shares cookies across `*.eduai.ok.ubc.ca` and validates production redirects under that domain. The current extension domains are outside that cookie scope.

IT has been asked to provide production aliases under `eduai.ok.ubc.ca` for the extensions. Until those aliases are available, Core can be deployed independently, but seamless Core-to-extension browser authentication is not considered production-ready.

## Work phases

1. Audit and clean environment contracts without exposing or committing secrets.
2. Provision Core PostgreSQL, Redis, backups, TLS, reverse proxy, and systemd services.
3. Configure production Core and validate connectivity to the reachable inference host(s).
4. Deploy `main` manually using locked dependencies and Prisma migrations.
5. Verify authentication, health endpoints, AI routing, backups, and restart recovery.
6. Add a server-side continuous-deployment runner with locking, backup, health checks, and rollback.
7. Add extension aliases and extension deployments after IT updates DNS and TLS.

## Deployment guardrails

- Do not use the legacy `apps/core/deploy.sh` unchanged.
- Do not run `prisma db push` in production.
- Do not automatically seed production during every deploy.
- Keep secrets in server-managed files outside Git.
- Keep database and application ports private behind the reverse proxy.
- Deploy only clean, reviewed commits from `main`.
- Keep the previous release available until post-deploy checks pass.

## Initial production host inventory

Read-only checks were performed over SSH on 2026-08-11.

- Public host resolves to `s348.ok.ubc.ca`; the existing checkout is `/srv/www/my.eduai.ok.ubc.ca`.
- `/srv/www/eduai.ok.ubc.ca` is a symlink to the Core checkout.
- Host OS is Ubuntu 22.04; Node is `v22.18.0` and npm is `10.8.2`.
- Apache and Docker services are running. The application account cannot currently access the Docker socket without additional group/sudo configuration.
- PostgreSQL is listening on `127.0.0.1:5432`; Redis was not listening on the inspected ports.
- The existing checkout is on `main` at old commit `c1c7097`, with broad file drift and untracked deployment state. It must not be reset or pulled over in place before a backup/migration plan exists.
- The existing checkout uses an older Core-only layout with PM2-era deployment files, not the current monorepo production layout.
- DNS resolves cmps01, cmps02, and cmps03. Initial port probing did not establish connectivity to cmps01:8001, and the remaining probes timed out; firewall/routing access still needs confirmation.

## Local environment audit

The root `.env` cleanup is complete: the five obsolete application/frontend port overrides were removed, leaving only the database port overrides currently consumed by the development compose file. The root `.env.example` remains the documented source for those overrides plus the optional Redis port.

The remaining application-local variables were classified by searching runtime code, scripts, tests, and configuration:

| File | Classification | Variables |
|---|---|---|
| `apps/core/.env` | Active | `FIRECRAWL_API_KEY`, `OPENROUTER_API_KEY`, `LOG_LEVEL`, and other configured Core runtime values |
| `apps/core/.env` | Removal candidates | `LOCAL_EMBEDDING_RUNTIME`, `ROUTER_AUTO_DEFAULT`, `UBC_TIMEZONE` have no current runtime/config references |
| `apps/extensions/question-maker/.env` | Active/test-only | `LOG_LEVEL` is active; `TEST_DATABASE_URL` is test-only |
| `apps/extensions/question-maker/.env` | Removal candidates | `JWT_SECRET`, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`, `OPENROUTER_API_KEY`, and `OPENROUTER_EMBEDDING_MODEL` have no current references in the repository |

The candidate variables should be removed from local files only after confirming they are not required by an external, server-side process. They should not be copied into the new production environment.

## Change log

### 2026-08-11

- Confirmed Core-only production scope at `my.eduai.ok.ubc.ca`.
- Confirmed `main` as the production release branch.
- Confirmed production databases need to be provisioned.
- Confirmed the intended inference fleet is cmps01, cmps02, and cmps03, subject to firewall availability.
- Created planning branch `codex/production-deployment` from `origin/development` at `b5a6746f6`.
- Preserved the existing feature branch and linked worktrees; no worktrees were deleted.
- Identified the cross-domain authentication dependency for the existing extension domains.
- Removed five obsolete root `.env` port overrides (`CORE_PORT`, `TUTOR_FE_PORT`, `TUTOR_BE_PORT`, `QM_FE_PORT`, `QM_BE_PORT`) from the local ignored environment; the current compose stack reads only database and Redis port overrides.
- Added secret-free production Core templates under `infra/production/`: bootstrap runbook, environment template, systemd unit, and Apache reverse-proxy configuration.
- Chose a new `/srv/www/eduai-production` release layout so the stale production checkout remains available during migration.
- Added a read-only `infra/production/preflight.sh` for repeatable host, dependency, service, and inference reachability checks.
- Ran the preflight remotely without installing it: PostgreSQL and cmps01:8001 are reachable; Redis is absent; cmps02/03 are blocked or unavailable; Core is inactive; the public Core URL returns HTTP 503; and the new production release/config directories do not yet exist.
- Confirmed the production PostgreSQL listener is Docker-managed by the existing `eduai-pgvector` container (`pgvector/pgvector:pg15`) on `127.0.0.1:5432`; reuse this container rather than installing a second PostgreSQL instance.
- Confirmed cmps01, cmps02, and cmps03 are now network-reachable from s348. Requests without credentials return proxy/auth errors (`403` on cmps01 and `401` on cmps02/03), so the inference fleet is reachable and requires the configured internal API key.
- Created and verified a 23 MB custom-format backup of the existing `eduai` database at `/srv/www/eduai-production/shared/backups/eduai-legacy-20260812-134416.dump`; the legacy database remains untouched.
- Added `infra/production/PROVISIONING_CHECKLIST.md`, separating non-privileged preparation from interactive sudo/database/Apache actions and requiring a dedicated production database role.
- Preserved unrelated local changes in `TESTS.md`, `docs/end-user-testing-core-student-ta-1429.md`, and `tests/e2e/tests/core/ai-chat-happy-path.spec.ts`; they are not part of deployment commits.
- Created a separate operations worktree at `.worktrees/production-ops` on branch `codex/production-ops` so deployment work does not interfere with another agent's branch.
- Added a root-owned, fixed-action production helper and narrow sudoers procedure for local Redis and Core/Apache service bootstrap.
- Created the new empty `eduai_prod` database with owner group `eduai_prod_admins`, application login `eduai_prod_app`, and pgvector `0.8.1`; the existing `eduai` database remains untouched.
