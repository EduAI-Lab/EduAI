# Narrow sudo setup

Use a fixed root-owned helper rather than broad passwordless sudo. An administrator
must first install the reviewed environment, systemd, and Apache templates as
root-owned files under `/etc/eduai/production-templates`:

```bash
sudo install -d -o root -g root -m 0750 /etc/eduai/production-templates
sudo install -o root -g root -m 0640 /path/to/eduai-core.env /etc/eduai/production-templates/eduai-core.env
sudo install -o root -g root -m 0644 /path/to/eduai-core.service /etc/eduai/production-templates/eduai-core.service
sudo install -o root -g root -m 0644 /path/to/my.eduai.ok.ubc.ca.conf /etc/eduai/production-templates/my.eduai.ok.ubc.ca.conf
sudo install -o root -g root -m 0644 /path/to/eduai-aitutor-server.service /etc/eduai/production-templates/eduai-aitutor-server.service
sudo install -o root -g root -m 0644 /path/to/aitutor.eduai.ok.ubc.ca.conf /etc/eduai/production-templates/aitutor.eduai.ok.ubc.ca.conf
sudo install -o root -g root -m 0640 /path/to/eduai-qm.env /etc/eduai/production-templates/eduai-qm.env
sudo install -o root -g root -m 0644 /path/to/eduai-qm-backend.service /etc/eduai/production-templates/eduai-qm-backend.service
sudo install -o root -g root -m 0644 /path/to/questionmaker.eduai.ok.ubc.ca.conf /etc/eduai/production-templates/questionmaker.eduai.ok.ubc.ca.conf
sudo install -o root -g root -m 0644 /path/to/eduai-cron-worker.service /etc/eduai/production-templates/eduai-cron-worker.service
```

The deployment account must not be able to write this directory. After copying
`admin-helper.sh` to the server, an administrator runs:

```bash
sudo install -o root -g root -m 0755 \
  /path/to/infra/production/admin-helper.sh \
  /usr/local/sbin/eduai-production-admin
```

Then create `/etc/sudoers.d/eduai-production` with `visudo`:

```text
ssaada08 ALL=(root) NOPASSWD: /usr/local/sbin/eduai-production-admin
```

Validate it:

```bash
sudo visudo -cf /etc/sudoers.d/eduai-production
sudo -n /usr/local/sbin/eduai-production-admin redis-install
```

The helper has a fixed action allow-list, rejects all extra arguments, and reads
only the fixed root-owned templates under `/etc/eduai/production-templates`,
the root-owned database env files it creates, and the fixed `infra/cron` scripts
from the already validated active release. Release activation validates all
generated clients and frontend entrypoints and grants Apache access through a
user ACL limited to the two static build trees. Review and reinstall it whenever
the repository version changes.
