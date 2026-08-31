# EduAI deployment guide

Last verified: 2026-08-31

This page is the deployment index. It describes the supported deployment paths and
links to the runbook that owns each detail. The repository scripts and the server
state are authoritative; examples in this document are not proof that a service is
currently healthy.

## Choose the right runbook

| Task | Canonical guide | Scope |
| --- | --- | --- |
| Local development | This page and each app's README | Workstation-only development services |
| Shared development / s378 | [`infra/s378/GO-LIVE.md`](../infra/s378/GO-LIVE.md) | Built Core, AI Tutor, Question Maker, and cron-worker deployment |
| Production / s348 | [`infra/production/README.md`](../infra/production/README.md) | Release-based production deployment and rollback |
| Production preflight | [`infra/production/PROVISIONING_CHECKLIST.md`](../infra/production/PROVISIONING_CHECKLIST.md) | Host, database, environment, inference, and web-server checklist |
| Production privilege boundary | [`infra/production/SUDOERS_SETUP.md`](../infra/production/SUDOERS_SETUP.md) | Restricted administrative helper and root-owned templates |
| Inference host | [`infra/cmps01/README.md`](../infra/cmps01/README.md) | CMPS Docker, vLLM, LiteLLM, nginx, and embedding service |
| Backups and scheduled maintenance | [`infra/cron/README.md`](../infra/cron/README.md) | Backup scripts and the s378 cron-worker installation |

Application-specific deployment notes remain under `apps/`. Authentication and
first-admin bootstrap are documented in
[`apps/core/docs/DEPLOYMENT.md`](../apps/core/docs/DEPLOYMENT.md).

## Deployment contracts

The supported runtime layout is:

| Component | Development | Production |
| --- | --- | --- |
| Core web application | s378, `127.0.0.1:3000` | s348, `127.0.0.1:3000` |
| AI Tutor API | s378, `127.0.0.1:4000` | s348, `127.0.0.1:4000` |
| Question Maker backend | s378, `127.0.0.1:8000` | s348, `0.0.0.0:8000` in the current deployment |
| Browser frontends | Built static assets served by the web server | Built static assets served by the web server |
| Database | Development containers on host ports | Host-managed PostgreSQL, normally `127.0.0.1:5432` |
| Redis | Development container on host port `63790` | Host-managed Redis when enabled; queueing is currently disabled |
| Inference | CMPS fleet behind port `8001` | Only approved and healthy CMPS endpoints |

Development uses the public hosts below after the web server is configured:

- Core: `https://dev.eduai.ok.ubc.ca`
- AI Tutor: `https://dev.aitutor.eduai.ok.ubc.ca`
- Question Maker: `https://dev.questionmaker.eduai.ok.ubc.ca`

Production uses `https://my.eduai.ok.ubc.ca`,
`https://aitutor.eduai.ok.ubc.ca`, and
`https://questionmaker.eduai.ok.ubc.ca`.

## Source of truth and safe boundaries

- `infra/s378/go-live-build.sh` is the canonical shared-development deployer.
- `infra/s378/go-live-systemd-install.sh` installs the s378 system units and
  supporting files; it does not build or start the applications.
- `infra/production/admin-helper.sh` is the restricted production administration
  interface. It is the only supported path for the privileged production actions
  listed in [`SUDOERS_SETUP.md`](../infra/production/SUDOERS_SETUP.md).
- `infra/cmps01/migrate.sh` is the repository-managed inference-host procedure.
- `apps/core/deploy.sh` and `apps/extensions/ai-tutor/deploy.sh` are legacy PM2
  templates. They are not the s378 or production deployment mechanism and should
  not be used as a substitute for the runbooks above.
- Never commit `.env` files, API keys, database passwords, model credentials, or
  generated secrets. The deployment scripts intentionally refuse some unsafe
  environment-file and dirty-checkout states.
- Do not copy commands from a server's current working tree into a runbook without
  checking them against the corresponding file in the repository. A server may
  contain an older release, local backup, or an uncommitted operational change.

## Local development

From the repository root:

```bash
npm install
npm run dev
```

The root development command starts the application services after the development
databases are available. The compose file used by the root scripts is
`docker-compose.dev.yml`:

| Service | Host port |
| --- | ---: |
| Core PostgreSQL | `54320` |
| AI Tutor PostgreSQL | `54321` |
| Question Maker PostgreSQL | `55432` |
| Redis | `63790` |

For an individual app, use its package scripts and README. Do not use production
environment files for local development. Before testing an authenticated API,
complete the Core authentication bootstrap described in
[`apps/core/docs/DEPLOYMENT.md`](../apps/core/docs/DEPLOYMENT.md).

## Shared development deployment

The shared development checkout is normally:

```text
/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
```

The complete procedure, including one-time systemd installation, belongs in
[`infra/s378/GO-LIVE.md`](../infra/s378/GO-LIVE.md). The short operational path is:

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
git status --short
git fetch origin
git checkout development
git pull --ff-only origin development
bash infra/s378/go-live-build.sh --install
```

The deployer performs environment synchronization, Prisma client generation,
migrations, reference and extension seed steps, builds, service restarts, and
port checks in a defined order. It must run from the intended checkout and will
refuse unsafe environment files or an unsuitable working tree. Review the script
output before treating the deployment as successful.

Useful scoped deploys are:

```bash
bash infra/s378/go-live-build.sh --only core
bash infra/s378/go-live-build.sh --only aitutor
bash infra/s378/go-live-build.sh --only qm
bash infra/s378/go-live-build.sh --no-restart
```

The exact aliases and flags are maintained in the script and its runbook. The
`--install` flag is idempotent setup for the host's systemd/polkit/cron support; it
does not replace the build and verification steps.

### Shared-development health checks

Use the service-local endpoints when diagnosing a unit, then verify the public
vhost:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8000/healthz
curl -fsSI https://dev.eduai.ok.ubc.ca/
curl -fsSI https://dev.aitutor.eduai.ok.ubc.ca/
curl -fsSI https://dev.questionmaker.eduai.ok.ubc.ca/
systemctl --no-pager --full status eduai-core eduai-cron-worker eduai-aitutor-server eduai-qm-backend
```

The Question Maker health route is `/healthz`; `/api/health` is the Core and AI
Tutor route. A successful HTTP response does not prove that inference, database
migrations, authentication, or background jobs are configured correctly.

## Inference fleet

The current Qwen deployment contract uses these served model IDs:

- small tier: `qwen3.5-2b-instruct`
- large tier: `qwen3.5-9b-instruct` where that tier is installed
- planned future capacity: `qwen3.8-27b` (not currently deployed)

The fleet is not homogeneous. As verified on 2026-08-31:

| Host | Direct backends observed | Authenticated port-8001 result |
| --- | --- | --- |
| CMPS01 | Qwen 3.5 2B, Qwen 3.5 9B, `mxbai-embed-large` | HTTP 200 with model list |
| CMPS02 | Qwen 3.5 2B, Qwen 2.5 32B | HTTP 200 with model list |
| CMPS03 | Qwen 3.5 2B, Qwen 3.5 9B | HTTP 400 `no_db_connection` |

The CMPS03 result is the last verified readiness issue reported to IT; no IT
resolution was available during this documentation pass. Its direct backends
responded during the audit, but that does not clear the port-8001 edge failure.
Keep CMPS03 out of an approved production fleet until the authenticated edge
check succeeds and the operational owner confirms the host. CMPS02's 32B model
is a separate capability and must not be documented as the standard 9B large tier.

The port-8001 edge is authenticated. Never put the shared inference key in a
document, command history, browser URL, or client-side bundle. See
[`infra/cmps01/README.md`](../infra/cmps01/README.md) for the host-level proxy
and model deployment contract.

## Backups and scheduled work

Core's production scheduler and the s378 `eduai-cron-worker` are distinct from
the standalone scripts in `infra/cron/`. The scripts back up the Core, AI Tutor,
and Question Maker databases, apply retention, and support off-site copies. They
do not create a system crontab by themselves. See
[`infra/cron/README.md`](../infra/cron/README.md) for installation, environment
files, schedules, and restore considerations.

Before a migration or release, confirm that a recent backup exists and that the
backup destination is writable. A backup job completing successfully does not
prove that a restore has been tested.

## Production deployment

Production uses release directories under:

```text
/srv/www/eduai-production/releases/<release-id>
/srv/www/eduai-production/current -> <release-id>
```

The production runbook and checklist are intentionally release-oriented. They
cover dependency installation, Prisma generation, migrations, asset builds,
activation, service management, Apache configuration, health verification, and
rollback. Do not run `npm run dev`, PM2 deployment templates, or ad-hoc commands
against the active release.

The production verification checklist should always include:

- Core: `http://127.0.0.1:3000/api/health`
- AI Tutor: `http://127.0.0.1:4000/api/health`
- Question Maker: `http://127.0.0.1:8000/healthz`
- public HTTPS checks for the three production vhosts
- systemd state, recent journal output, database connectivity, and approved
  inference-edge model IDs
- queue configuration, which is currently disabled unless deliberately re-enabled

Do not report production as ready from a single HTTP check. Record the active
release ID, commit, timestamp, and any failed component in the deployment handoff.

## Troubleshooting order

1. Identify the host, active release/checkout, branch or commit, and systemd unit.
2. Check the unit journal and the service-local health endpoint.
3. Check environment presence and model IDs without printing secrets.
4. Confirm database connectivity and migration status.
5. Confirm the public vhost and Apache configuration.
6. For inference failures, test the authenticated port-8001 edge and then the
   direct backend only as a diagnostic comparison.
7. Record the observed commit, timestamp, HTTP status, and remediation owner in an
   issue or handoff. Do not turn a one-off incident into a permanent runbook step.

For service-specific commands and rollback details, follow the canonical runbook
for the environment instead of duplicating them here.
