# EduAI GitHub → Discord PR notifier

The application exposes a GitHub webhook for `EduAI-Lab/EduAI`. It creates one public Discord thread per pull request and keeps all PR activity in that thread.

## Configure Discord

1. Create a Discord application and add its bot to the server.
2. Give it access to the PR channel with **View Channel**, **Send Messages**, **Create Public Threads**, and **Send Messages in Threads**.
3. Copy the bot token, guild ID, and PR parent channel ID into the environment variables in `.env.example`.
4. Enable the Guild Members privileged intent if Discord requires it for member search. This lets the service turn the supplied Discord handles into real mentions. A failed lookup deliberately falls back to a generic, non-pinging message.

## Configure GitHub

Create a GitHub App installed only on `EduAI-Lab/EduAI`, set its webhook URL to `https://YOUR_HOST/api/github/webhook`, and set the same secret as `GITHUB_WEBHOOK_SECRET`. Give the app read access to Pull requests and Checks.

Subscribe to these webhook events:

- **Pull request** (assignments, draft/ready state, commits, conflicts)
- **Pull request review** (approval and requested changes)
- **Check suite** (CI success/failure)

## Scheduled reminders

Invoke `GET /api/github/pr-reminders` every hour from a scheduler, with `Authorization: Bearer $PR_REMINDER_SECRET`.

The endpoint sends:

- an unaddressed-changes reminder every two business days, provided the author has not pushed since the request;
- reviewer reminder after one business day and one reassignment suggestion after two;
- an author reminder after five business days of inactivity.

## Mention mappings

Keep team-specific mappings private in `DISCORD_HANDLE_MAP`, as a JSON object mapping
GitHub login names to Discord usernames. Do not commit real usernames or server-specific
identifiers. Users without a mapping receive generic thread updates rather than an invalid mention.
