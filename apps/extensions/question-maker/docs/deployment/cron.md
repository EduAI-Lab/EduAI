# Scheduled deployment

Question Maker can poll the reviewed `development` branch with the checked-in
`scripts/daily-deploy.sh`. The script is fail-closed: it refuses a dirty or
diverged checkout, never runs `git reset --hard` or `git clean`, and never puts
a credential in the Git remote URL.

## Prerequisites

- Clone the full EduAI monorepo at `/srv/www/EduAI` (or set `PROJECT_DIR`).
- Configure `origin` with a read-only SSH deploy key or an operating-system Git
  credential helper. Do not store a GitHub token in the application `.env`.
- Install Docker with Compose support.
- Create the production Question Maker `.env` from `.env.example` and supply
  secrets through the host secret-management process.
- Ensure the deployment user can run Docker without an interactive sudo prompt.

Verify authentication without exposing credentials:

~~~sh
cd /srv/www/EduAI
git remote -v
git fetch origin development
~~~

An HTTPS origin containing `user:token@...` is rejected by the deploy script.
Use `git@github.com:ORG/REPO.git` or a credential-helper-backed HTTPS URL.

## Manual verification

Run the exact scheduled command once before enabling a timer:

~~~sh
cd /srv/www/EduAI
PROJECT_DIR=/srv/www/EduAI BRANCH=development \
  apps/extensions/question-maker/scripts/daily-deploy.sh
~~~

The command should:

1. abort if the checkout has local changes;
2. fetch and fast-forward only to `origin/development`;
3. build the production Compose images from the monorepo root;
4. restart the stack; and
5. report every service healthy.

If the local branch diverges, the script stops for operator review. Resolve the
branch deliberately; do not add a destructive reset fallback.

## Systemd timer

Install the checked-in service and timer after reviewing their user, group, and
paths for the target host:

~~~sh
sudo cp apps/extensions/question-maker/question-maker-deploy.service /etc/systemd/system/
sudo cp apps/extensions/question-maker/question-maker-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now question-maker-deploy.timer
~~~

Inspect status and logs:

~~~sh
systemctl list-timers question-maker-deploy.timer
sudo systemctl status question-maker-deploy.service
sudo journalctl -u question-maker-deploy.service -f
~~~

## Cron alternative

Systemd is preferred because it provides locking and structured logs. If cron
is required, schedule the same script and set the branch explicitly:

~~~cron
0 2 * * * PROJECT_DIR=/srv/www/EduAI BRANCH=development /srv/www/EduAI/apps/extensions/question-maker/scripts/daily-deploy.sh >> /var/log/question-maker/cron-deploy.log 2>&1
~~~

Never place a PAT or other credential directly in a crontab, command line,
remote URL, or application environment file.
