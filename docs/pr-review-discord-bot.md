# EduAI GitHub → Discord PR notifier

The standalone service exposes a GitHub webhook for `EduAI-Lab/EduAI`. It creates one public Discord thread per pull request and keeps all PR activity in that thread.

## Configure Discord

1. Create a Discord application and add its bot to the server.
2. Give it **View Channel**, **Send Messages**, **Create Public Threads**, and **Send Messages in Threads** permissions in the PR channel.
3. Configure the bot token, guild ID, and PR parent channel ID.
4. Configure `DISCORD_HANDLE_MAP` privately if plain-text Discord usernames should be included in targeted messages. The bot does not create pings.

## Configure GitHub

Create a GitHub App installed only on `EduAI-Lab/EduAI`, set its webhook URL to `https://YOUR_HOST/github/pr-webhook`, and set the same secret as `GITHUB_WEBHOOK_SECRET`. Give the app read access to Pull requests and Checks.

Subscribe to these webhook events:

- **Pull request** (assignments, draft/ready state, commits, conflicts)
- **Pull request review** (approval and requested changes)
- **Check suite** (CI success/failure)

## Scheduled reminders

Invoke `GET /api/github/pr-reminders` every hour from a scheduler, with `Authorization: Bearer $PR_REMINDER_SECRET`.

The endpoint sends:

- an unaddressed-changes reminder every two business days, provided the author has not pushed since the request;
- reviewer reminder every 24 hours, starting 24 hours after assignment, until that reviewer approves or requests changes;
- an author reminder after five business days of inactivity.

## Display-name mappings

Keep team-specific mappings private in `DISCORD_HANDLE_MAP`, as a JSON object mapping
GitHub login names to Discord usernames. Do not commit real usernames or server-specific
identifiers. Mappings are displayed as plain text and are never sent as Discord mentions.
