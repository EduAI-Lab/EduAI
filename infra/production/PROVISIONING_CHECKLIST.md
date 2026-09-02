# Production provisioning checklist

Last verified: 2026-08-31

Use this checklist for a new production host, a rebuild, or a material change to
the production deployment. It is a prerequisite checklist, not a record that every
item is currently complete. Check each item against the live host and record the
evidence in the deployment handoff.

## 1. Host and release layout

- [ ] Confirm the production host is `s348.ok.ubc.ca` and the approved deployment
      account is available.
- [ ] Confirm the release root exists:
      `/srv/www/eduai-production/releases`.
- [ ] Confirm `/srv/www/eduai-production/current` is a symlink to a reviewed
      release directory.
- [ ] Confirm release and service ownership/permissions before installing units.
- [ ] Confirm the release checkout is clean and its branch/commit is recorded.
- [ ] Confirm no `.env.production` files or other forbidden environment files are
      present in the release.
- [ ] Confirm the host has the Node.js/npm version expected by the repository.
- [ ] Confirm systemd, Apache2, Docker, and the required PostgreSQL client tools
      are installed.

## 2. Database, Redis, and backups

- [ ] Confirm production PostgreSQL is reachable at the configured host/port,
      normally `127.0.0.1:5432`.
- [ ] Confirm the Core database exists and the configured database user has only
      the required privileges.
- [ ] Confirm AI Tutor and Question Maker database ownership/connection details
      match their application environment.
- [ ] Confirm migrations are run with `prisma migrate deploy` or the repository
      package script; never use `prisma db push` for production.
- [ ] Confirm Redis is intentionally enabled or disabled. The current production
      host has host-managed Redis at `127.0.0.1:6379`, but queue enqueueing is
      currently disabled.
- [ ] Confirm the backup scripts and destination are configured.
- [ ] Confirm a recent backup exists before migration.
- [ ] Confirm restore ownership and the last restore test date; a successful
      backup is not a restore test.

## 3. Root-owned configuration

- [ ] Install `/etc/eduai/eduai-core.env` from
      [`core.env.example`](./core.env.example), replacing every placeholder.
- [ ] Install the AI Tutor environment and database environment from the matching
      templates when AI Tutor is enabled.
- [ ] Keep environment files root-owned with the group/read permissions expected
      by the systemd units; do not place secrets in the release checkout.
- [ ] Confirm production URLs, cookie domain, CORS origins, ports, database URLs,
      and API-key relationships.
- [ ] Confirm session/authentication secrets are stable for the release and are
      not regenerated during a routine deploy.
- [ ] Confirm `NODE_ENV=production` and production logging/telemetry settings.
- [ ] Confirm queue settings explicitly. The current safe baseline is
      `QUEUE_ENQUEUE_ENABLED=false` and `QUEUE_MAX_DEPTH=0`.
- [ ] If an API key is deliberately rotated, follow the migration preflight and
      set `EDUAI_ACK_API_KEY_ROTATION=1` only for that approved rotation.

## 4. Inference fleet

The application model catalog and the physical host inventory are different
things. A model name in an environment template is not evidence that every
endpoint serves it.

- [ ] Test each candidate port-8001 endpoint with its bearer key without printing
      the key or response headers.
- [ ] Confirm the returned model IDs exactly match the application configuration.
- [ ] Confirm the standard small tier is `qwen3.5-2b-instruct`.
- [ ] Confirm the standard large tier is `qwen3.5-9b-instruct` only on hosts that
      actually advertise it.
- [ ] Treat `qwen3.8-27b-instruct` on CMPS02 as the separate Assist Auto model,
      not as the standard large tier.
- [ ] Confirm CMPS03 advertises `qwen3.5-2b-instruct` and
      `qwen3.5-9b-instruct` through its authenticated edge before enabling it in
      the production fleet.
- [ ] If an edge returns `no_db_connection` / `No connected db.`, first verify
      that the proxy's LiteLLM `master_key` matches Core's `VLLM_API_KEY`. This
      DB-less deployment can report an authentication mismatch with that
      misleading database error; direct backend responses do not clear an edge
      failure.
- [ ] Record the host, edge status, model IDs, timestamp, and owner in the release
      handoff.

The repository's production Core template should be reconciled with the actual
endpoint model lists before changing the fleet. Keep CMPS02's 27B assignment
separate from the standard 9B tier, and do not assume every host advertises every
model.

## 5. Core application

- [ ] Run dependency installation from the repository root with `npm ci`.
- [ ] Generate the Core Prisma client using the release's package script.
- [ ] Run the Core migration preflight.
- [ ] Apply Core migrations.
- [ ] Run only the approved reference seed, if required by the release. Do not run
      fixture/performance seeds as a normal production step.
- [ ] Build Core and confirm the output is inside the reviewed release directory.
- [ ] Install/update `eduai-core.service` from the repository template.
- [ ] Confirm the Core unit uses the active release symlink and the root
      `node_modules` path expected by its `ExecStart`.
- [ ] Confirm Core health returns HTTP 200 at
      `http://127.0.0.1:3000/api/health`.

## 6. AI Tutor

- [ ] Generate the AI Tutor Prisma client before enabling the service.
- [ ] Apply AI Tutor migrations using the release's package script.
- [ ] Build the AI Tutor frontend and confirm its static output.
- [ ] Install/update the AI Tutor environment and systemd unit.
- [ ] Install/update the AI Tutor Apache vhost and certificate configuration.
- [ ] Confirm the unit uses the active release and has access to the generated
      `@eduai/ai-tutor-prisma-client` package.
- [ ] Confirm `http://127.0.0.1:4000/api/health` and its public HTTPS vhost.
- [ ] Confirm the Core public URL and CORS settings match the deployed hostname.

## 7. Question Maker

Question Maker is a separate extension with its own application deployment
documentation and Compose file. The production helper provides narrowly scoped
install, enable, and restart actions for its environment, systemd unit, and
Apache vhost; it does not provide a general Question Maker shell or a combined
database-provisioning action.

- [ ] Follow [`apps/extensions/question-maker/docs/deployment/README.md`](../../apps/extensions/question-maker/docs/deployment/README.md).
- [ ] Generate the Question Maker Prisma client and confirm the backend database
      migration is complete.
- [ ] Confirm the backend process and its database configuration.
- [ ] Confirm the frontend build and Apache/static asset configuration.
- [ ] Install the reviewed environment, systemd unit, and Apache vhost through
      `install-qm-env`, `install-qm-unit`, and `install-qm-apache`.
- [ ] Confirm the backend health route is
      `http://127.0.0.1:8000/healthz`; `/api/health` is not its health route.
- [ ] Enable and restart the backend through `enable-qm` and `restart-qm` only
      after the migration, build, and health checks are ready.

## 8. Cron worker

- [ ] Create `/etc/eduai/cron.env` with production database, backup, and alert
      values; keep it root-owned and mode `0640`.
- [ ] Create the `eduai-cron` account and its intended backup/log directories.
- [ ] Install the root-owned cron worker unit and synchronize the allow-listed
      scripts with `install-cron-worker`.
- [ ] Enable and restart `eduai-cron-worker` only after the Core environment and
      cron configuration are readable.

## 9. Web server and systemd

- [ ] Confirm required Apache modules, certificates, proxy rules, and vhosts.
- [ ] Run `apache2ctl configtest` before reloading Apache.
- [ ] Confirm public HTTPS for Core, AI Tutor, and Question Maker.
- [ ] Install systemd units from the repository templates or the approved helper.
- [ ] Run `systemctl daemon-reload` after unit changes.
- [ ] Enable only the services included in the approved release.
- [ ] Confirm the active release, unit status, recent journal output, and listeners.
- [ ] Confirm no unsupported PM2/user-level process is serving the production apps.

## 10. Release verification

Run and record:

```bash
readlink -f /srv/www/eduai-production/current
git -C /srv/www/eduai-production/current log -1 --oneline
systemctl --no-pager --full status eduai-core eduai-aitutor-server eduai-qm-backend
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8000/healthz
curl -fsSI https://my.eduai.ok.ubc.ca/
curl -fsSI https://aitutor.eduai.ok.ubc.ca/
curl -fsSI https://questionmaker.eduai.ok.ubc.ca/
```

- [ ] Database migrations are recorded.
- [ ] Model IDs and authenticated inference-edge results are recorded.
- [ ] Queue state is recorded.
- [ ] No secrets appear in output, logs, the release, or the handoff.
- [ ] Rollback release ID and database rollback owner are recorded.
- [ ] The release is not called ready until failed checks have an owner and a
      documented disposition.

## Current server facts

The 2026-08-31 host audit found PostgreSQL on 5432, Redis on 6379, Apache2 and
Docker active, and `current` resolving to release `ec9036dda` (short commit
`ec9036d` on `main`) under `/srv/www/eduai-production/current`. These facts
should be rechecked at provisioning time; they are not substitutes for the
checklist.
