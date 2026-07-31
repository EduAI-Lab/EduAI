# Discord bot for the shared dev server

This service exposes two guild-only Discord commands:

- `/dev-status` reports the checked-out branch, short commit, and working-tree state.
- `/dev-branch branch:<name>` deploys an exact branch from `origin`, then announces
  the result in the configured channel.

Only explicitly allowlisted Discord users or roles may switch branches. Status is
available to everyone in the configured Discord server. The bot uses slash
commands, so it does not need Discord's privileged Message Content intent.

## Safety behavior

Before changing the server, `deploy-branch.sh`:

1. Acquires a non-blocking deployment lock.
2. Validates the branch as a Git branch name and passes it as an argument, never
   interpolated into a shell command.
3. Refuses to proceed if the shared checkout has tracked or untracked changes.
4. Fetches `origin` and requires the exact remote branch to exist.
5. Checks out the remote commit, runs `npm ci`, starts the Core database, then
   hands off to `infra/s378/go-live-build.sh` (env, Prisma generate/migrate/seed
   for all three apps, build, restart, and its own port-based health check).

`go-live-build.sh` ships with PR #1285 (moving s378 to group-owned system
units serving pre-built bundles instead of `npm run dev`). Branches that
predate that migration have no `infra/s378/go-live-build.sh` and
`deploy-branch.sh` refuses to deploy them rather than limp along with a stale
build under units that no longer run a dev server. No `sudo` is involved:
restarting `eduai-*` units is authorized for members of the `eduai-dev` group
via the polkit rule PR #1285 installs at `/etc/polkit-1/rules.d/49-eduai-dev.rules`.

Database migrations are not automatically reversible. A feature branch with a
destructive or dimension-changing migration still requires team coordination and
the procedure in `docs/rag-ai/EMBEDDINGS.md`.

## 1. Create the Discord application

In the Discord Developer Portal:

1. Create an application and bot, then copy its application ID and bot token.
2. Install it in the intended server with the `bot` and
   `applications.commands` scopes.
3. Give it only `View Channels`, `Send Messages`, and `Embed Links` in the
   notification channel. Message Content intent is not needed.
4. In Discord settings, enable Developer Mode and copy the guild, channel,
   permitted role, and/or permitted user IDs.

Treat the bot token and webhook URL like passwords.

## 2. Configure and install on s378

Run from the repository root:

```bash
bash infra/s378/discord-dev-bot/install.sh
```

Edit `~/.config/eduai/discord-dev-bot.env`. At least one
`DISCORD_ALLOWED_USER_IDS` or `DISCORD_ALLOWED_ROLE_IDS` entry should be set;
otherwise all branch-switch requests are denied.

The installer places the runtime in `~/.local/share/eduai-discord-dev-bot`.
Keeping it outside the Git checkout is intentional: switching to an older
feature branch must not delete the running bot. Rerun the installer after
updating the bot implementation.

Systemd `EnvironmentFile` values are unquoted `KEY=value` lines. Do not put
spaces around `=`.

Register the guild commands and start the bot:

```bash
cd ~/.local/share/eduai-discord-dev-bot
set -a
source ~/.config/eduai/discord-dev-bot.env
set +a
npm run register

systemctl --user daemon-reload
systemctl --user enable --now discord-dev-bot.service
systemctl --user status discord-dev-bot.service
journalctl --user -u discord-dev-bot.service -f
```

Guild commands normally appear quickly. Test `/dev-status` first, then use a
small, migration-free branch for the first `/dev-branch` deployment.

## 3. Report manual deployments

For a one-way notification without switching from Discord, create an incoming
webhook for the notification channel, set `DISCORD_WEBHOOK_URL` in the bot env,
then run after a successful manual deployment:

```bash
cd ~/.local/share/eduai-discord-dev-bot
set -a
source ~/.config/eduai/discord-dev-bot.env
set +a
DEPLOY_ACTOR="$USER" npm run notify
```

This webhook path is optional. Branch changes performed through `/dev-branch`
already announce success or failure through the bot.

## Operations

```bash
systemctl --user restart discord-dev-bot.service
journalctl --user -u discord-dev-bot.service --since today
```

After updating command definitions, rerun `npm run register`. Rotate the Discord
token immediately if it is ever printed, committed, or shared.
