# Production privilege boundary

Last verified: 2026-08-31

Use a fixed root-owned helper rather than broad passwordless sudo. The helper is
an operational boundary for the actions in `infra/production/admin-helper.sh`; it
is not a general shell, deployment shell, or Question Maker administrator.

## Root-owned templates

An administrator must install the reviewed templates under:

```text
/etc/eduai/production-templates
```

The current helper reads these eleven fixed template files:

| Template | Installed destination |
| --- | --- |
| `eduai-core.env` | `/etc/eduai/eduai-core.env` |
| `eduai-core.service` | `/etc/systemd/system/eduai-core.service` |
| `my.eduai.ok.ubc.ca.conf` | `/etc/apache2/sites-available/my.eduai.ok.ubc.ca.conf` |
| `eduai-aitutor.env` | `/etc/eduai/eduai-aitutor.env` |
| `aitutor-db.env` | `/etc/eduai/aitutor-db.env` |
| `eduai-aitutor-server.service` | `/etc/systemd/system/eduai-aitutor-server.service` |
| `aitutor.eduai.ok.ubc.ca.conf` | `/etc/apache2/sites-available/aitutor.eduai.ok.ubc.ca.conf` |
| `eduai-qm.env` | `/etc/eduai/eduai-qm.env` |
| `eduai-qm-backend.service` | `/etc/systemd/system/eduai-qm-backend.service` |
| `questionmaker.eduai.ok.ubc.ca.conf` | `/etc/apache2/sites-available/questionmaker.eduai.ok.ubc.ca.conf` |
| `eduai-cron-worker.service` | `/etc/systemd/system/eduai-cron-worker.service` |

Install them as root:

```bash
sudo install -d -o root -g root -m 0750 /etc/eduai/production-templates
sudo install -o root -g root -m 0640 /path/to/eduai-core.env \
  /etc/eduai/production-templates/eduai-core.env
sudo install -o root -g root -m 0644 /path/to/eduai-core.service \
  /etc/eduai/production-templates/eduai-core.service
sudo install -o root -g root -m 0644 /path/to/my.eduai.ok.ubc.ca.conf \
  /etc/eduai/production-templates/my.eduai.ok.ubc.ca.conf
sudo install -o root -g root -m 0644 /path/to/eduai-aitutor.env \
  /etc/eduai/production-templates/eduai-aitutor.env
sudo install -o root -g root -m 0640 /path/to/aitutor-db.env \
  /etc/eduai/production-templates/aitutor-db.env
sudo install -o root -g root -m 0644 /path/to/eduai-aitutor-server.service \
  /etc/eduai/production-templates/eduai-aitutor-server.service
sudo install -o root -g root -m 0644 /path/to/aitutor.eduai.ok.ubc.ca.conf \
  /etc/eduai/production-templates/aitutor.eduai.ok.ubc.ca.conf
sudo install -o root -g root -m 0640 /path/to/eduai-qm.env \
  /etc/eduai/production-templates/eduai-qm.env
sudo install -o root -g root -m 0644 /path/to/eduai-qm-backend.service \
  /etc/eduai/production-templates/eduai-qm-backend.service
sudo install -o root -g root -m 0644 /path/to/questionmaker.eduai.ok.ubc.ca.conf \
  /etc/eduai/production-templates/questionmaker.eduai.ok.ubc.ca.conf
sudo install -o root -g root -m 0644 /path/to/eduai-cron-worker.service \
  /etc/eduai/production-templates/eduai-cron-worker.service
```

The deployment account must not be able to write the template directory. Keep
secret-bearing templates out of Git and out of command output.

## Install the helper

After reviewing the repository version, install it root-owned:

```bash
sudo install -o root -g root -m 0755 \
  /path/to/infra/production/admin-helper.sh \
  /usr/local/sbin/eduai-production-admin
```

Create `/etc/sudoers.d/eduai-production` with `visudo`:

```text
ssaada08 ALL=(root) NOPASSWD: /usr/local/sbin/eduai-production-admin
```

Validate both files:

```bash
sudo visudo -cf /etc/sudoers.d/eduai-production
sudo -n /usr/local/sbin/eduai-production-admin redis-install
```

The helper rejects extra arguments and validates release IDs before operating on
the release directory.

## Current action allow-list

The current repository helper permits:

| Action | Purpose |
| --- | --- |
| `redis-install` | Create/start the managed Redis container and verify it |
| `install-env` | Install the Core environment template |
| `install-core-unit` | Install the Core systemd unit |
| `install-apache-vhost` | Install/enable the Core Apache vhost |
| `install-aitutor-db-env` | Install the AI Tutor database environment |
| `install-aitutor-env` | Install the AI Tutor environment |
| `install-aitutor-unit` | Install the AI Tutor systemd unit |
| `install-aitutor-apache` | Install/enable the AI Tutor Apache vhost |
| `install-qm-env` | Install the Question Maker environment |
| `install-qm-unit` | Install the Question Maker systemd unit |
| `install-qm-apache` | Install/enable the Question Maker Apache vhost |
| `aitutor-db-install` | Create/start the AI Tutor database container |
| `provision-aitutor` | Apply the supported AI Tutor provisioning sequence |
| `install-cron-worker` | Install and synchronize the Core cron worker |
| `activate-release <release-id>` | Move the production `current` symlink to an existing release |
| `enable-aitutor` | Enable the AI Tutor unit |
| `restart-aitutor` | Restart AI Tutor and show its status |
| `enable-qm` | Enable the Question Maker unit |
| `restart-qm` | Restart Question Maker and show its status |
| `enable-cron-worker` | Enable the Core cron worker |
| `restart-cron-worker` | Restart the Core cron worker and show its status |
| `enable-core` | Enable the Core unit |
| `restart-core` | Restart Core and show its status |
| `reload-apache` | Run `apache2ctl configtest` and reload Apache |

The `activate-release` action accepts an existing hexadecimal release ID only. It
does not build a release, run migrations, seed a database, or validate application
health.

Question Maker is intentionally limited to the three template-install actions
and its enable/restart actions. Its database and build procedure remain in
[`apps/extensions/question-maker/docs/deployment/README.md`](../../apps/extensions/question-maker/docs/deployment/README.md);
the helper does not expose a general shell or a `provision-qm` command.

## Review requirements

- Review changes to `admin-helper.sh` before reinstalling it.
- Review every template as root before installation.
- Run `apache2ctl configtest` before any Apache reload.
- Confirm the active release and service journals after `activate-release`.
- Keep sudoers access limited to the exact helper path.
- Remove or replace obsolete installed copies through an administrator-reviewed
  change; do not broaden the sudoers rule to compensate.
