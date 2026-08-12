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
