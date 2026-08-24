#!/bin/bash

# Question Maker - Daily Automated Deployment Script
# This script runs daily to pull latest changes and redeploy
# Uses the repository's preconfigured SSH deploy key or Git credential helper.
# Designed to run via cron job

set -euo pipefail

# Configuration
PROJECT_DIR="${PROJECT_DIR:-/srv/www/EduAI}"
BRANCH="${BRANCH:-development}"
LOG_FILE="/var/log/question-maker/daily-deploy.log"
FALLBACK_LOG_FILE="$PROJECT_DIR/.git/question-maker-deploy.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to get the active log file (handles permission issues)
get_log_file() {
    # Check if we can write to the primary log location
    if [ -w "$LOG_FILE" ] 2>/dev/null || ([ -d "$(dirname "$LOG_FILE")" ] && [ -w "$(dirname "$LOG_FILE")" ] 2>/dev/null); then
        echo "$LOG_FILE"
    # Fall back to project directory
    elif [ -w "$FALLBACK_LOG_FILE" ] 2>/dev/null || ([ -d "$(dirname "$FALLBACK_LOG_FILE")" ] && [ -w "$(dirname "$FALLBACK_LOG_FILE")" ] 2>/dev/null); then
        echo "$FALLBACK_LOG_FILE"
    else
        echo "/dev/null"  # Discard if no writable location
    fi
}

# Function to log output (handles permission issues gracefully)
log_output() {
    ACTIVE_LOG=$(get_log_file)
    if [ "$ACTIVE_LOG" != "/dev/null" ]; then
        echo -e "$1" | tee -a "$ACTIVE_LOG"
    else
        echo -e "$1"
    fi
}

# Function to print colored output
print_status() {
    log_output "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    log_output "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    log_output "${RED}[ERROR]${NC} $1"
}

print_header() {
    log_output "${BLUE}========================================${NC}"
    log_output "${BLUE}$1${NC}"
    log_output "${BLUE}========================================${NC}"
}

# Create the log directory only when this service account already has
# permission. Scheduled deployments must not depend on interactive sudo.
if [ ! -d "$(dirname "$LOG_FILE")" ]; then
    if mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null; then
        : # Success
    else
        # Fall back to project directory for logs
        LOG_FILE="$FALLBACK_LOG_FILE"
        mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    fi
fi

# Log start time
print_header "Daily Deployment Started - $(date)"

# Check if we're in the right directory
if [ ! -d "$PROJECT_DIR" ]; then
    print_error "Project directory not found: $PROJECT_DIR"
    exit 1
fi

# Navigate to project directory
cd "$PROJECT_DIR"

# Check if git repository exists
if [ ! -d ".git" ]; then
    print_error "Not a git repository: $PROJECT_DIR"
    exit 1
fi

# Authentication must already be configured outside the application env via
# an SSH deploy key or OS credential helper. Never persist a PAT in `.git/config`.
REPO_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$REPO_URL" ]; then
    print_error "Could not determine repository URL from git remote"
    exit 1
fi
if [[ "$REPO_URL" == https://*:*@* ]]; then
    print_error "Origin URL contains embedded credentials. Replace it with SSH or a credential-helper URL before deploying."
    exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    print_error "Deployment aborted: repository has local changes."
    git status --short | tee -a "$(get_log_file)"
    exit 1
fi

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
print_status "Current branch: $CURRENT_BRANCH"

# Check if we need to switch branches
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    print_warning "Not on $BRANCH branch. Switching to $BRANCH..."
    git switch "$BRANCH"
fi

# Fetch latest changes
print_status "Fetching latest changes from origin/$BRANCH..."
git fetch origin "$BRANCH" || {
    print_error "Failed to fetch from origin. Check network connectivity and git credentials."
    exit 1
}

# Compare local vs remote commits
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse "origin/$BRANCH")

print_status "Local commit:  ${LOCAL_COMMIT:0:7}"
print_status "Remote commit: ${REMOTE_COMMIT:0:7}"

# Exit early if no changes (efficient)
if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    print_status "Already up to date. No changes to deploy."
    exit 0
fi

# Changes detected - proceed with deployment
print_status "Changes detected! Updating from ${LOCAL_COMMIT:0:7} to ${REMOTE_COMMIT:0:7}"

ACTIVE_LOG=$(get_log_file)
print_status "Fast-forwarding to origin/$BRANCH..."
git merge --ff-only "origin/$BRANCH" 2>&1 | tee -a "$ACTIVE_LOG" || {
    print_error "Fast-forward failed. Resolve branch divergence manually; no files were discarded."
    exit 1
}

# Rebuild and restart Docker containers
print_status "Rebuilding Docker images (no cache)..."
ACTIVE_LOG=$(get_log_file)
docker compose -f apps/extensions/question-maker/docker-compose.yml build --no-cache 2>&1 | tee -a "$ACTIVE_LOG" || {
    print_error "Docker build failed. Check logs above."
    exit 1
}

print_status "Starting containers with updated images and waiting for readiness..."
docker compose -f apps/extensions/question-maker/docker-compose.yml \
    up -d --remove-orphans --wait --wait-timeout 120 2>&1 | tee -a "$ACTIVE_LOG" || {
    print_error "Failed to start healthy containers. Check logs above."
    docker compose -f apps/extensions/question-maker/docker-compose.yml logs --tail=50 | tee -a "$ACTIVE_LOG" || true
    exit 1
}

# Check container status
print_status "Container Status:"
docker compose -f apps/extensions/question-maker/docker-compose.yml ps | tee -a "$ACTIVE_LOG"

# Web-server reload is opt-in and must be granted explicitly to the service
# account by the host operator.
if [ "${RELOAD_WEB_SERVER:-false}" = "true" ]; then
    print_status "Reloading web server..."
    sudo systemctl reload httpd 2>/dev/null \
        || sudo systemctl reload apache2 2>/dev/null \
        || { print_error "Web-server reload failed."; exit 1; }
fi

ACTIVE_LOG=$(get_log_file)
print_header "Daily Deployment Completed Successfully - $(date)"
print_status "Deployment log saved to: $ACTIVE_LOG"
