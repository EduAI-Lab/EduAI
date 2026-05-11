#!/bin/bash

# What:
#    This script pulls latest git changes then restarts pm2 (uses ecosystem.config.cjs).
# Prereqs:
#    git repo was previously pulled to /srv/www/AiTutor
#    docker is installed — docker-compose.yml runs PostgreSQL
#    pm2 and bun are installed
# Usage:
#    ./deploy.sh [--force]
#    If --force is passed, deployment will continue even with no new commit.

# Variables
GIT_BRANCH="main"
REPO_DIR="/srv/www/AiTutor"
DOCKER_COMPOSE_FILE="docker-compose.yml"
LAST_COMMIT_FILE="$REPO_DIR/.last_commit"
LOCKFILE="/tmp/deploy-aitutor.lock"

# Function to clean up the lock file on exit
cleanup() {
    rm -f "$LOCKFILE"
}
trap cleanup EXIT INT TERM

# Check for the --force flag
FORCE_DEPLOY=false
if [ "$1" == "--force" ]; then
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

# Ensure a clean working state (preserves .env files)
git reset --hard
git clean -fd --exclude=.env --exclude=server/.env
git checkout "$GIT_BRANCH"

# Fetch the latest changes
git fetch origin

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

# Pull the latest changes and reset to the latest commit
git pull origin "$GIT_BRANCH" || { echo "Git pull failed. Exiting."; exit 1; }

# Set execute permissions for deploy.sh so it can run after the pull
chmod +x deploy.sh

# ---- Dependencies ----
echo "Installing frontend dependencies..."
bun install || { echo "bun install (frontend) failed. Exiting."; exit 1; }

echo "Installing server dependencies..."
cd server && bun install || { echo "bun install (server) failed. Exiting."; exit 1; }
cd "$REPO_DIR"

# ---- Docker (PostgreSQL) ----
echo "Starting Docker containers..."
sudo docker compose up -d || { echo "Docker compose failed. Exiting."; exit 1; }

# ---- Database migrations ----
echo "Running database migrations..."
cd server
bunx prisma generate || { echo "Prisma generate failed. Exiting."; exit 1; }
bunx prisma migrate deploy || { echo "Prisma migrate failed. Exiting."; exit 1; }
cd "$REPO_DIR"

# ---- Build frontend ----
echo "Building frontend application..."
bun run build || { echo "Build failed. Exiting."; exit 1; }

# ---- Restart backend with PM2 ----
echo "Restarting application with PM2..."
pm2 restart ecosystem.config.cjs --update-env 2>/dev/null || pm2 start ecosystem.config.cjs || { echo "PM2 start failed. Exiting."; exit 1; }
pm2 save

# Save the latest commit hash
echo "$LATEST_COMMIT" > "$LAST_COMMIT_FILE"

# Remove the lock file when done
rm -f "$LOCKFILE"

echo "Deployment complete: $(date)"

# Restart Apache
echo "Restarting Apache Server (need sudo access - press escape to skip)"
sudo systemctl restart httpd
