# Narrow sudo setup

Use a fixed root-owned helper rather than broad passwordless sudo. An administrator
must first install the reviewed environment, systemd, and Apache templates as
root-owned files under `/etc/eduai/production-templates`:

```bash
sudo install -d -o root -g root -m 0750 /etc/eduai/production-templates
sudo install -o root -g root -m 0640 /path/to/eduai-core.env /etc/eduai/production-templates/eduai-core.env
sudo install -o root -g root -m 0644 /path/to/eduai-core.service /etc/eduai/production-templates/eduai-core.service
sudo install -o root -g root -m 0644 /path/to/my.eduai.ok.ubc.ca.conf /etc/eduai/production-templates/my.eduai.ok.ubc.ca.conf
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
only the three fixed root-owned templates under `/etc/eduai/production-templates`.
Review and reinstall it whenever the repository version changes.
