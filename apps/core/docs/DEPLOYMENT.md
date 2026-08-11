# Core deployment safety

The Prisma seed creates deterministic local fixture users, including an
`ADMIN`, with a known password. It is never a production/shared bootstrap
mechanism. Both `prisma/seed.ts` and `prisma/seed-if-empty.ts` fail closed unless
all of these values are explicit:

```text
NODE_ENV=development
EDUAI_DEPLOYMENT_MODE=local
EDUAI_ENABLE_LOCAL_DEMO=true
```

Any missing, malformed, `shared`, or `production` mode refuses before reading
or writing the database. The login page has no demo-login controls; fixed
credentials are not sent to public/shared clients.

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
