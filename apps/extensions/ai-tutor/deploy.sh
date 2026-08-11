#!/bin/bash
set -euo pipefail

# What:
#    This script pulls latest git changes then restarts pm2 (uses ecosystem.config.cjs).
# Prereqs:
#    git repo was previously pulled to /srv/www/AiTutor
#    docker is installed — docker-compose.yml runs PostgreSQL
#    pm2 and node/npm are installed
# Usage:
#    ./deploy.sh [--force]
#    If --force is passed, deployment will continue even with no new commit.

# Variables
GIT_BRANCH="${GIT_BRANCH:-development}"
REPO_DIR="${REPO_DIR:-/srv/www/EduAI}"
APP_DIR="$REPO_DIR/apps/extensions/ai-tutor"
DOCKER_COMPOSE_FILE="$APP_DIR/docker-compose.yml"
LAST_COMMIT_FILE="$REPO_DIR/.git/last_deployed_ai_tutor"
LOCKFILE="/tmp/deploy-aitutor.lock"

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
echo $$ > "$LOCKFILE"

#----------------#

echo "Starting deployment process..."

# Navigate to the repository
cd "$REPO_DIR" || { echo "Failed to change directory to $REPO_DIR"; rm -f "$LOCKFILE"; exit 1; }

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "Deployment aborted: repository has local changes."
    git status --short
    exit 1
fi

git fetch origin "$GIT_BRANCH"
git switch "$GIT_BRANCH"

# Get the latest commit hash on the branch
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

git merge --ff-only "origin/$GIT_BRANCH" || { echo "Fast-forward failed. Exiting."; exit 1; }

# ---- Dependencies ----
echo "Installing locked monorepo dependencies..."
npm ci --no-audit --no-fund || { echo "npm ci failed. Exiting."; exit 1; }

# ---- Docker (PostgreSQL) ----
echo "Starting Docker containers..."
docker compose -f "$DOCKER_COMPOSE_FILE" up -d || { echo "Docker compose failed. Exiting."; exit 1; }

# ---- Database migrations ----
echo "Running database migrations..."
npm exec -w ai-tutor-server -- prisma generate || { echo "Prisma generate failed. Exiting."; exit 1; }
npm exec -w ai-tutor-server -- prisma migrate deploy || { echo "Prisma migrate failed. Exiting."; exit 1; }

# ---- Build frontend ----
echo "Building frontend application..."
npm run build -w ai-tutor || { echo "Build failed. Exiting."; exit 1; }

# ---- Restart backend with PM2 ----
echo "Restarting application with PM2..."
(
    cd "$APP_DIR"
    pm2 restart ecosystem.config.cjs --update-env 2>/dev/null \
        || pm2 start ecosystem.config.cjs
) || { echo "PM2 start failed. Exiting."; exit 1; }
pm2 save

# Save the latest commit hash
echo "$LATEST_COMMIT" > "$LAST_COMMIT_FILE"

# Remove the lock file when done
rm -f "$LOCKFILE"

echo "Deployment complete: $(date)"

if [ "${RELOAD_WEB_SERVER:-false}" = "true" ]; then
    sudo systemctl reload httpd
fi
