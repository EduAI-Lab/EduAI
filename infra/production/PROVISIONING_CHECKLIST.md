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

Required secrets must be generated outside Git. Keep the initial fleet value limited to the reachable cmps host:

```env
VLLM_FLEET_CHAT_URLS=http://cmps01.ok.ubc.ca:8001
```

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
- cmps02/03 are not configured until firewall access is confirmed.
- No extension URL is configured until the new aliases and authentication flow are ready.
- Apache config validates.
- The legacy checkout and its data remain available for rollback/reference.
