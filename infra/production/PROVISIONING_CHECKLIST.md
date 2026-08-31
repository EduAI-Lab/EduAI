# Production Core provisioning checklist

Use this checklist on `s348.ok.ubc.ca` before the first production release. The legacy checkout at `/srv/www/my.eduai.ok.ubc.ca` is not modified by these steps.

## 1. Confirm the host account and groups

```bash
hostname
id ssaada08
getent group eduai
```

The service account must be able to read the release tree and the environment file through group permissions. Do not add the application account to the Docker group unless Docker is part of the approved production architecture.

## 2. Create the release and configuration paths

```bash
sudo install -d -o ssaada08 -g eduai -m 2775 /srv/www/eduai-production/releases
sudo install -d -o ssaada08 -g eduai -m 2775 /srv/www/eduai-production/shared
sudo install -d -o ssaada08 -g eduai -m 0750 /var/log/eduai
sudo install -d -o root -g eduai -m 0750 /etc/eduai
sudo install -d -o root -g root -m 0750 /etc/eduai/production-templates
```

Install the reviewed environment, systemd unit, and Apache vhost templates in
that directory as `root:root` (0640 for the environment file, 0644 for the
unit and vhost). It must not be writable by `ssaada08` or the `eduai` group.

## 3. Provision PostgreSQL

PostgreSQL is already listening on `127.0.0.1:5432`, but its ownership, database name, role, extensions, and backup policy must be confirmed before using it.

As a database administrator, create a dedicated production role and database. Do not reuse credentials from the legacy `.env`:

```sql
CREATE ROLE eduai_prod LOGIN PASSWORD '<generated-password>';
CREATE DATABASE eduai_prod OWNER eduai_prod;
```

Then verify `pgvector` is available in the new database and confirm the backup destination. The application account should not receive unrestricted PostgreSQL superuser access.

## 4. Provision Redis

Redis is not currently listening. Choose one approved option:

- IT-managed Redis, referenced by a private `REDIS_URL`; or
- A locally managed Redis service bound to `127.0.0.1:6379`.

Do not enable `QUEUE_ENQUEUE_ENABLED=true` until Redis and the Core worker are both deployed and tested. The initial Core release can run with queue enqueue disabled.

## 5. Install the production environment

Copy `infra/production/core.env.example` to `/etc/eduai/eduai-core.env`, replace placeholders, and validate that no placeholder remains:

```bash
sudo install -o root -g eduai -m 0640 /path/to/eduai-core.env /etc/eduai/eduai-core.env
sudo grep -nE '<[^>]+>|CHANGE_ME|REPLACE_ME' /etc/eduai/eduai-core.env
```

Required secrets must be generated outside Git. This release requires the
interactive cmps01 fleet and the retained Assist Auto model on cmps02:

```env
VLLM_FLEET_CHAT_URLS=http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001
VLLM_FLEET_DEFAULT_MODELS=qwen3.5-2b-instruct,qwen3.5-9b-instruct
ADHD_ASSIST_AUTO_MODEL=vllm:qwen2.5-32b-instruct
```

Run `cd apps/core && npm run fleet:smoke` from a host with campus access and
do not enable the service until both hosts are healthy and cmps02 advertises
`qwen2.5-32b-instruct`.

## 6. Install and enable Core

Copy `infra/production/systemd/eduai-core.service` to `/etc/systemd/system/`, review the Node executable path, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable eduai-core
```

Do not start it until a release is present at `/srv/www/eduai-production/current` and the environment/database checks pass.

## 7. Configure Apache

Install `infra/production/apache/my.eduai.ok.ubc.ca.conf` only after confirming the institutionally managed TLS certificate paths and required proxy modules:

```bash
sudo a2enmod proxy proxy_http headers ssl
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Keep Node bound to `127.0.0.1:3000`; Apache is the only public application listener.

## 8. Final pre-release checks

- Database backup and restore test completed.
- `pgvector` is available.
- `DATABASE_URL` connects as the dedicated application role.
- Redis decision is documented; queue remains disabled if no worker exists.
- cmps01 inference endpoint is reachable from production.
- cmps02 inference endpoint is reachable and advertises `qwen2.5-32b-instruct` for Assist Auto; cmps03 remains outside this rollout until firewall access and its model inventory are confirmed.
- `VITE_AI_TUTOR_URL=https://aitutor.eduai.ok.ubc.ca` and `VITE_QUESTION_MAKER_URL=https://questionmaker.eduai.ok.ubc.ca` are configured before browser builds.
- `COOKIE_DOMAIN=.ok.ubc.ca` and the AI Tutor `EDUAI_API_KEY` match across both services; confirm no unrelated `*.ok.ubc.ca` service should receive the shared cookie.
- The AI Tutor vhost relies on the certificate already covering `*.eduai.ok.ubc.ca` on this host (no explicit `SSLCertificateFile` in the template); confirm that coverage, and that Apache config validates.
- The legacy checkout and its data remain available for rollback/reference.

## 9. Provision Question Maker

Create a dedicated Question Maker database and role on the host PostgreSQL
instance, then install the reviewed API environment, systemd unit, and Apache
vhost templates. The API must use `127.0.0.1:5432` (not the Docker-only
`postgres` hostname), and the frontend must be built with the public-only
values from `question-maker-frontend.env`.

Verify before enabling traffic:

- `DATABASE_URL` points to the dedicated Question Maker database.
- `EDUAI_API_KEY` matches Core's service key.
- `CORE_DATABASE_URL` and `CORE_ENCRYPTION_KEY` are present if the one-time
  Canvas credential migration still has source rows.
- `questionmaker.eduai.ok.ubc.ca` Apache configuration passes `apache2ctl
  configtest` and its TLS certificate covers the hostname.
- `curl -fsS http://127.0.0.1:8000/healthz` and
  `curl -fsS http://127.0.0.1:8000/readyz` succeed after the unit starts.
