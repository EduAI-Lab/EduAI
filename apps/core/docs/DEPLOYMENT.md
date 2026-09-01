# Core deployment safety

The Prisma seed creates deterministic local fixture users, including an
`ADMIN`, with the caller-supplied local password. It is never a
production/shared bootstrap mechanism. Both `prisma/seed.ts` and
`prisma/seed-if-empty.ts` fail closed unless
all of these values are explicit, including a caller-supplied fixture password:

```text
NODE_ENV=development
EDUAI_DEPLOYMENT_MODE=local
EDUAI_ENABLE_LOCAL_DEMO=true
BETTER_AUTH_URL=http://localhost:3000
EDUAI_LOCAL_SEED_PASSWORD=<unique-local-only-password>
```

The auth URL must be `http://` or `https://` with an exact loopback hostname
(`localhost`, `127.0.0.1`, or `::1`) and no userinfo. Any missing, malformed,
public, `shared`, or `production` setting refuses before reading or writing the
database. Generate `EDUAI_LOCAL_SEED_PASSWORD` for each disposable local
database (for example, `openssl rand -base64 24`) and never copy it to shared or
production systems. The login page has no demo-login controls; fixture
credentials are not sent to public/shared clients.

For a fresh disposable database, export the generated value before starting
Core (the `.env` file may hold it locally):

```sh
export EDUAI_LOCAL_SEED_PASSWORD="$(openssl rand -base64 24)"
npm run db:seed:if-empty
```

The disposable perf-volume fixture (`npm run db:seed:perf`) uses the same
loopback gate and `EDUAI_LOCAL_SEED_PASSWORD`; it also refuses shared or
production deployments before reset/seed writes.

Before promoting a database that ever used local fixtures, operators must:

1. Remove every known fixture account (including `admin@eduai.local` and the
   other `@eduai.local` users), or replace each with individually provisioned
   accounts and random credentials.
2. Rotate `BETTER_AUTH_SECRET` if it was reused outside local development.
3. Revoke/rotate active sessions for removed or migrated users (delete their
   Better Auth `session` rows or use the supported session-revocation workflow).
4. Verify no fixture password or accept link appears in logs, backups, copied
   environment files, or client assets.

The local gate is for disposable developer/test databases only. Shared and
production deployments must use an explicit account-provisioning/rotation
runbook rather than `npm run db:seed:if-empty`.

## First administrator on a shared database

After migrations and `npm run db:seed:reference`, an operator can create the
only unauthenticated administrator invitation. The command refuses to run when
an ADMIN account already exists, a pending ADMIN invitation already exists, or
an account with that email already exists, and it stores only the token hash
(SHA-256; the raw token is never persisted, only printed once to stdout as
part of the accept-invitation URL). The whole check-and-create runs inside a
transaction behind a Postgres advisory lock, so two concurrent runs cannot
both win the race:

```sh
cd apps/core
CORE_BOOTSTRAP_ADMIN_EMAIL=operator@ubc.ca \
CORE_BOOTSTRAP_ADMIN_NAME="Platform Operator" \
npm run auth:bootstrap-admin
```

Send the one-time URL printed by the command to that operator through an
approved private channel. It expires after 24 hours. After acceptance, create
all further privileged accounts through the normal Admin invitations page;
never rerun the fixture seed or change `auth.allowPublicRegistration` for this
bootstrap.

## Migration preflight and API-key rotation

Run `npm run db:migrate:preflight` immediately before `prisma migrate deploy`.
It stops on duplicate external course identities or duplicate active re-embed
jobs regardless of migration state. The legacy-API-key check only runs if the
`20260811120000_better_auth_api_key_contract` migration has **not** yet been
applied (it's a one-time pre-migration warning, not a standing check); when it
runs, it lists each owner whose key would expire under the one-year cap —
notify those owners and rotate their keys before acknowledging the inventory
with `EDUAI_ACK_API_KEY_ROTATION=1 npm run db:migrate:preflight`.

The Better Auth API-key migration preserves hashes and owners, but converts
`metadata` and `permissions` from JSONB to text. That cast is intentionally not
automatically reversible. The unique course-identity index is also built as a
regular PostgreSQL index and can hold a table lock while it is created, so run
this migration in the deployment maintenance window.

## Extension session validation

`EDUAI_API_KEY` is now a hard requirement for any extension calling
`POST /api/sessions/validate`. On Core's side (`app/routes/api/sessions.validate.ts`)
the response is deterministic: no `Authorization: Bearer` header at all →
`401 {"error":"MISSING_SERVICE_KEY"}`; a header present but not matching
Core's configured key (or Core has none configured) → `403
{"error":"INVALID_SERVICE_KEY"}`. Question Maker fails at startup if Core is
configured and the key is missing; that startup check lives in Question
Maker's own codebase, not here.
