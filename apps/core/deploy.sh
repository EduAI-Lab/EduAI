#!/bin/bash
set -euo pipefail

# What:
#	This script pulls latest git changes then restart pm2 (uses ecosystem.config.cjs).
# TODO before using:
#	1. see comments (1) and (2) below to update variables
# 	2. your project must be cloned from git repo first to server /path/to/your-app (must be same as as/in/etc/conf.d)
# 	3. if you are using docker, it must be installed and we use docker-compose.yml - if docker not used, remove docker entries below
#	4. make sure pm2 is installed on server (see guidelines document)
# Usage:
#	./deploy.sh [--force]
# 	If --force is passed, deployment will continue even with no new commit.

# Variables
GIT_BRANCH="${GIT_BRANCH:-development}"
REPO_DIR="${REPO_DIR:-/srv/www/EduAI}"
APP_DIR="$REPO_DIR/apps/core"
DOCKER_COMPOSE_FILE="docker-compose.yml"
LAST_COMMIT_FILE="$REPO_DIR/.git/last_deployed_core"
LOCKFILE="/tmp/deploy.lock"

# Function to clean up the lock file on exit
cleanup() {
    rm -f "$LOCKFILE"
}
trap cleanup EXIT INT TERM

# Check for the --force flag
FORCE_DEPLOY=false
if [ "${1:-}" == "--force" ]; then
    FORCE_DEPLOY=true
    echo "Force deploy enabled: will rebuild and deploy even if no new commit."
fi


# Lock file mechanism: Check if the lock file exists and the process is still running
if [ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null; then
    echo "Deploy script is already running. Exiting."
    exit 1
fi
echo $$ > "$LOCKFILE"	# Create a lock file with the current process ID

#----------------#

echo "Starting deployment process..."

# Navigate to the repository
cd "$REPO_DIR" || { echo "Failed to change directory to $REPO_DIR"; rm -f "$LOCKFILE"; exit 1; }

# Refuse to erase or deploy over operator-owned files. Credentials belong in
# ignored env files or a secret manager; any other local change needs review.
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "Deployment aborted: repository has local changes."
    git status --short
    exit 1
fi

# Fetch and fast-forward only. Never rewrite or clean the deployment checkout.
git fetch origin "$GIT_BRANCH"
git switch "$GIT_BRANCH"

# Get the latest commit hash on the dev branch
LATEST_COMMIT=$(git rev-parse origin/"$GIT_BRANCH")

# Compare with the last deployed commit if not forcing deploy
if [ "$FORCE_DEPLOY" = false ] && [ -f "$LAST_COMMIT_FILE" ]; then
    LAST_COMMIT=$(cat "$LAST_COMMIT_FILE")
    if [ "$LATEST_COMMIT" == "$LAST_COMMIT" ]; then
        echo "No new changes. Exiting."
        rm -f "$LOCKFILE"
        exit 0
    fi
fi

# Update only when the local branch can fast-forward to the reviewed remote.
git merge --ff-only "origin/$GIT_BRANCH" || { echo "Fast-forward failed. Exiting."; exit 1; }

# Install dependencies, build, run migrations, and restart the app with PM2
echo "Installing dependencies..."
npm ci --no-audit --no-fund || { echo "npm ci failed. Exiting."; exit 1; }
echo "Building application..."
npm run build -w edu-ai || { echo "Build failed. Exiting."; exit 1; }
echo "Running database migrations..."
npm run db:generate -w edu-ai || { echo "Database client generation failed. Exiting."; exit 1; }
npm exec -w edu-ai -- prisma migrate deploy || { echo "Database migration failed. Exiting."; exit 1; }



echo "Restarting application with PM2..."
pm2 restart eduai-core --update-env 2>/dev/null \
    || pm2 start npm --name eduai-core --cwd "$APP_DIR" -- run start \
    || { echo "PM2 restart failed. Exiting."; exit 1; }
pm2 save

# Save the latest commit hash
echo "$LATEST_COMMIT" > "$LAST_COMMIT_FILE"

# Remove the lock file when done
rm -f "$LOCKFILE"

echo "Deployment complete: $(date)"

# Web-server reload is opt-in; the application restart does not require broad
# sudo access by default.
if [ "${RELOAD_WEB_SERVER:-false}" = "true" ]; then
    sudo systemctl reload apache2
fi
