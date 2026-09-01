# s378 shared-development go-live

Last verified: 2026-08-31

This is the canonical runbook for the shared development host, `s378.ok.ubc.ca`.
It deploys the built Core, AI Tutor, and Question Maker applications plus the
dedicated cron worker. It does not cover the Discord bot.

## Runtime contract

The checkout is normally:

```text
/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
```

The systemd services and local ports are:

| Unit | Application | Local listener |
| --- | --- | ---: |
| `eduai-core` | Core web application | `127.0.0.1:3000` |
| `eduai-cron-worker` | scheduled backup/maintenance worker | no public HTTP port |
| `eduai-aitutor-server` | AI Tutor API | `127.0.0.1:4000` |
| `eduai-qm-backend` | Question Maker backend | `127.0.0.1:8000` |

The browser clients are built during deployment and served by the host web server:

- Core: `https://dev.eduai.ok.ubc.ca`
- AI Tutor: `https://dev.aitutor.eduai.ok.ubc.ca`
- Question Maker: `https://dev.questionmaker.eduai.ok.ubc.ca`

There are no supported development `npm run dev` or user-level PM2 processes on
this host. The current deployment is systemd plus built static assets.

## Current verified snapshot

On 2026-08-31, the `development` checkout was at commit `5795f838f`. The four
application units were running, the expected listeners were present, and the
three public HTTPS roots returned HTTP 200. Treat this as a dated observation,
not a permanent health guarantee. Re-run the checks below after every deployment.

The checkout also contained untracked `.env` backup files. These are operational
artifacts, not deployment inputs. Preserve them securely and keep them out of Git;
a dirty checkout can prevent the deployer from proceeding.

## Prerequisites

Before deploying:

1. Connect to s378 with the approved account and use the checkout above.
2. Confirm the intended branch and commit.
3. Confirm that no unexpected tracked or untracked files are present.
4. Confirm that the required application environment files exist and are readable
   by the service account without exposing their values.
5. Confirm database and Redis containers are available on the ports expected by the
   environment.
6. Confirm that a recent backup exists before applying migrations.
7. Confirm that the intended inference endpoints are authenticated and advertise
   the model IDs expected by the application.

Useful read-only preflight commands:

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
git status --short
git branch --show-current
git log -1 --oneline
test -f apps/core/.env
test -f apps/extensions/ai-tutor/server/.env
test -f apps/extensions/question-maker/.env
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Do not use `git clean`, `git reset --hard`, or another destructive cleanup to make
the preflight pass. Resolve or relocate operational artifacts with the owner.

## One-time host installation

From the intended checkout, run:

```bash
bash infra/s378/go-live-build.sh --install
```

The install path is designed to be repeatable. It provisions the host support
needed by the go-live workflow, including:

- the `eduai-cron` service account and required directories;
- systemd units and the `eduai-dev.target`;
- polkit rules for the approved service operations;
- the cron scripts under `/opt/eduai/cron`;
- backup and log directories;
- the environment synchronization support used by the services.

Installation does not build the applications or start a deployment by itself. The
script will also remove or reject unsupported user-unit/linger arrangements rather
than allowing duplicate service managers to compete with systemd.

## Canonical deployment

Run the deployer from the repository root:

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
bash infra/s378/go-live-build.sh --install
```

The implementation owns the order:

1. validate the checkout and environment;
2. synchronize the host/application environment as configured;
3. generate the Core, AI Tutor, and Question Maker Prisma clients;
4. run the migration preflight and migrations;
5. seed only the reference and extension data required by the script;
6. build Core and the extension clients;
7. restart the affected systemd services;
8. poll expected listeners and report the result.

The Core restart is part of the build sequence so an old server process does not
continue serving assets from the previous build. Do not manually reorder these
steps around a migration or frontend build.

Supported scoped options include:

```bash
bash infra/s378/go-live-build.sh --only core
bash infra/s378/go-live-build.sh --only aitutor
bash infra/s378/go-live-build.sh --only qm
bash infra/s378/go-live-build.sh --no-env
bash infra/s378/go-live-build.sh --no-restart
```

Use `--only` when the script's dependency rules make a scoped deployment safe.
Use `--no-env` only when the environment has already been intentionally prepared.
Use `--no-restart` for build/migration work that must be reviewed before service
activation. Read `bash infra/s378/go-live-build.sh --help` before using an option
not listed here.

The migration preflight may require `EDUAI_ACK_API_KEY_ROTATION=1` when the
deployment detects an intentional API-key rotation. Set that acknowledgement only
for the approved rotation; it is not a general workaround for a failed migration.

## Environment and secrets

The shared Core `.env` is the source used for the shared inference/API key
synchronization. The environment helper writes the host-side service environment
and propagates the intended `EDUAI_API_KEY` relationship. Keep all values secret.

At minimum, verify these configuration classes without printing values:

- Core `NODE_ENV`, port, database URL, session/cookie settings, and public URL;
- AI Tutor and Question Maker database URLs and service ports;
- `REDIS_URL`, queue flags, and cron-worker settings;
- inference fleet URLs, served model IDs, and the embedding endpoint;
- CORS/origin settings for the three development vhosts.

The current s378 deployment has queue enqueueing disabled. The cron worker remains a
separate scheduled-maintenance service; it is not evidence that the AI job queue is
enabled.

## Static assets and web server

The go-live build produces browser assets for AI Tutor and Question Maker. Their
systemd units run the APIs; the host web server serves the built client output
through the configured development vhosts. There is no separate frontend unit to
restart.

After a build:

```bash
systemctl --no-pager --full status eduai-core eduai-cron-worker \
  eduai-aitutor-server eduai-qm-backend
curl -fsSI https://dev.eduai.ok.ubc.ca/
curl -fsSI https://dev.aitutor.eduai.ok.ubc.ca/
curl -fsSI https://dev.questionmaker.eduai.ok.ubc.ca/
```

Use the web-server service and configuration-test command appropriate to the host
when changing vhosts. Do not assume that a local development web-server command
applies to the RHEL host.

## Health and smoke checks

Service-local checks:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8000/healthz
```

The Core and AI Tutor APIs use `/api/health`. Question Maker uses `/healthz`.
Health responses verify reachability only; they do not verify database migrations,
authentication, inference, or the browser build.

For the inference edge, send the existing key without printing it:

```bash
for host in cmps01.ok.ubc.ca cmps02.ok.ubc.ca cmps03.ok.ubc.ca; do
  curl -fsS --max-time 10 \
    -H "Authorization: Bearer \${VLLM_API_KEY}" \
    "http://\${host}:8001/v1/models"
done
```

As of the last verification, CMPS01 and CMPS02 returned authenticated model lists;
CMPS03 returned HTTP 400 with `no_db_connection`. Direct backend success does not
clear an edge-proxy failure. See [`infra/cmps01/README.md`](../cmps01/README.md)
for the inference-host contract.

## Service operations

Prefer the target and units installed by the repository:

```bash
systemctl --no-pager --full status eduai-dev.target
systemctl --no-pager --full status eduai-core eduai-cron-worker \
  eduai-aitutor-server eduai-qm-backend
journalctl -u eduai-core -n 100 --no-pager
journalctl -u eduai-cron-worker -n 100 --no-pager
journalctl -u eduai-aitutor-server -n 100 --no-pager
journalctl -u eduai-qm-backend -n 100 --no-pager
```

Restart only the affected unit after a scoped change. Use the deployer's restart
path for normal releases so build, restart, and verification remain auditable.

## Failure handling and rollback

If the deployment fails:

1. Keep the command output and record the active commit.
2. Check the first failed phase; later errors may be consequences.
3. Verify whether migrations completed before retrying.
4. Check the relevant journal and listener.
5. Restore the last known-good code/config through a reviewed Git change.
6. Re-run the canonical deployer and repeat all local and public smoke checks.

s378 is not a release-symlink deployment like production. A code rollback means
selecting or restoring a reviewed known-good checkout state, then rebuilding and
restarting through `go-live-build.sh`. Do not overwrite environment backups or
discard untracked operational evidence while recovering.

## Related source files

The behavior of this runbook is implemented by:

- `infra/s378/go-live-build.sh`
- `infra/s378/go-live-env.sh`
- `infra/s378/go-live-systemd-install.sh`
- `infra/s378/systemd/`
- `infra/s378/apache/`
- `infra/s378/polkit/`
- `infra/s378/cron/`

When this document and those files disagree, update the document after resolving
the code/configuration change; do not silently invent a third procedure.
