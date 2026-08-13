# Narrow sudo setup

Use a fixed root-owned helper rather than broad passwordless sudo. After copying `admin-helper.sh` to the fixed staging path, an administrator runs:

```bash
sudo install -o root -g root -m 0755 \
  /srv/www/eduai-production/shared/staged/admin-helper.sh \
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
only the three fixed staging files under `/srv/www/eduai-production/shared/staged`.
Review and reinstall it whenever the repository version changes.
