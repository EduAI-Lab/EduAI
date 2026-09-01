#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install_dir="${EDUAI_DISCORD_BOT_DIR:-$HOME/.local/share/eduai-discord-dev-bot}"
config_dir="$HOME/.config/eduai"
unit_dir="$HOME/.config/systemd/user"

mkdir -p "$install_dir" "$config_dir" "$unit_dir"

# Keep the running bot outside the Git checkout. Switching to a branch created
# before the bot existed must not remove the bot that performs the deployment.
install -m 0644 \
  "$source_dir/package.json" \
  "$source_dir/package-lock.json" \
  "$source_dir/config.mjs" \
  "$source_dir/lib.mjs" \
  "$source_dir/bot.mjs" \
  "$source_dir/register-commands.mjs" \
  "$source_dir/notify.mjs" \
  "$install_dir/"
install -m 0755 "$source_dir/deploy-branch.sh" "$install_dir/"
install -m 0644 "$source_dir/discord-dev-bot.service" \
  "$unit_dir/discord-dev-bot.service"

if [[ ! -f "$config_dir/discord-dev-bot.env" ]]; then
  install -m 0600 "$source_dir/.env.example" \
    "$config_dir/discord-dev-bot.env"
  echo "Created $config_dir/discord-dev-bot.env; fill in its Discord values."
else
  echo "Preserved existing $config_dir/discord-dev-bot.env."
fi

npm --prefix "$install_dir" ci --omit=dev
systemctl --user daemon-reload

echo "Installed bot files in $install_dir."
echo "Next: edit $config_dir/discord-dev-bot.env, register commands, and start the service."
