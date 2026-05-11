#!/bin/bash

# Question Maker - Daily Automated Deployment Script
# This script runs daily to pull latest changes and redeploy
# Uses GitHub Personal Access Token from .env for authentication
# Designed to run via cron job

set -e  # Exit on any error

# Configuration
PROJECT_DIR="/srv/www/questionmaker.ok.ubc.ca"
BRANCH="main"
LOG_FILE="/var/log/question-maker/daily-deploy.log"
FALLBACK_LOG_FILE="$PROJECT_DIR/daily-deploy.log"
ENV_FILE="$PROJECT_DIR/.env"

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

# Create log directory if it doesn't exist
if [ ! -d "$(dirname "$LOG_FILE")" ]; then
    if mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null; then
        : # Success
    elif sudo mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null; then
        sudo chown "$USER:$USER" "$(dirname "$LOG_FILE")" 2>/dev/null || true
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

# Load GitHub token from .env file
if [ -f "$ENV_FILE" ]; then
    # Try to read GITHUB_TOKEN or GITHUB_PERSONAL_ACCESS_TOKEN from .env
    if grep -q "^GITHUB_TOKEN=" "$ENV_FILE" 2>/dev/null; then
        GITHUB_TOKEN=$(grep "^GITHUB_TOKEN=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" | xargs)
    elif grep -q "^GITHUB_PERSONAL_ACCESS_TOKEN=" "$ENV_FILE" 2>/dev/null; then
        GITHUB_TOKEN=$(grep "^GITHUB_PERSONAL_ACCESS_TOKEN=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" | xargs)
    elif grep -q "^PERSONAL_ACCESS_TOKEN=" "$ENV_FILE" 2>/dev/null; then
        GITHUB_TOKEN=$(grep "^PERSONAL_ACCESS_TOKEN=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" | xargs)
    fi
fi

# Check if token was found
if [ -z "$GITHUB_TOKEN" ]; then
    print_error "GitHub token not found in .env file."
    print_error "Please add one of: GITHUB_TOKEN, GITHUB_PERSONAL_ACCESS_TOKEN, or PERSONAL_ACCESS_TOKEN"
    exit 1
fi

# Get GitHub username from .env or use default
if [ -f "$ENV_FILE" ]; then
    if grep -q "^GITHUB_USERNAME=" "$ENV_FILE" 2>/dev/null; then
        GITHUB_USERNAME=$(grep "^GITHUB_USERNAME=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" | xargs)
    fi
fi

# Default username if not set (you can change this)
GITHUB_USERNAME=${GITHUB_USERNAME:-"superbolt08"}

# Get repository URL (extract from git remote)
REPO_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$REPO_URL" ]; then
    print_error "Could not determine repository URL from git remote"
    exit 1
fi

# Extract repository path from URL (handles both SSH and HTTPS, with or without token)
# Remove authentication if present, convert SSH to HTTPS format, extract path
if [[ "$REPO_URL" == git@* ]]; then
    # SSH format: git@github.com:user/repo.git -> github.com/user/repo
    REPO_PATH=$(echo "$REPO_URL" | sed 's/git@github.com://' | sed 's/\.git$//' | sed 's/\.git\/$//')
elif [[ "$REPO_URL" == https://* ]]; then
    # HTTPS format: https://user:token@github.com/user/repo.git or https://github.com/user/repo.git
    # Remove https:// and any authentication, then extract path
    REPO_PATH=$(echo "$REPO_URL" | sed 's|^https://||' | sed 's|^[^@]*@||' | sed 's/\.git$//' | sed 's/\.git\/$//' | sed 's/\/$//')
else
    print_error "Unknown repository URL format: $REPO_URL"
    exit 1
fi

# Configure git to use token for this repository
print_status "Configuring git authentication..."
GIT_URL_WITH_TOKEN="https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@${REPO_PATH}"
git remote set-url origin "$GIT_URL_WITH_TOKEN" 2>/dev/null || {
    print_warning "Could not update git remote URL, continuing with existing config"
}

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
print_status "Current branch: $CURRENT_BRANCH"

# Check if we need to switch branches
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    print_warning "Not on $BRANCH branch. Switching to $BRANCH..."
    git checkout "$BRANCH"
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

# For automated deployment, always favor remote changes
# Discard any local modifications to ensure clean deployment
ACTIVE_LOG=$(get_log_file)
if ! git diff-index --quiet HEAD -- || ! git diff --quiet || ! git diff --cached --quiet; then
    print_warning "Local changes detected. Discarding them to match remote (automated deployment favors remote)..."
    # Reset to match remote exactly (favors remote in all cases)
    git reset --hard "origin/$BRANCH" 2>&1 | tee -a "$ACTIVE_LOG" || {
        print_warning "Reset to remote failed, trying clean reset..."
        git clean -fd 2>&1 | tee -a "$ACTIVE_LOG" || true
        git reset --hard HEAD 2>&1 | tee -a "$ACTIVE_LOG" || true
        # Now try to pull with merge strategy favoring remote
        git pull origin "$BRANCH" --no-edit -X theirs 2>&1 | tee -a "$ACTIVE_LOG" || {
            print_error "Failed to sync with remote. Manual intervention required."
            print_error "Run: cd $PROJECT_DIR && git reset --hard origin/$BRANCH"
            exit 1
        }
    }
    print_status "Local changes discarded. Repository now matches remote."
else
    # No local changes, safe to pull normally
    print_status "Pulling latest changes from origin/$BRANCH..."
    git pull origin "$BRANCH" 2>&1 | tee -a "$ACTIVE_LOG" || {
        print_error "Failed to pull changes. Check git credentials and network."
        exit 1
    }
fi

# Rebuild and restart Docker containers
print_status "Rebuilding Docker images (no cache)..."
ACTIVE_LOG=$(get_log_file)
docker compose build --no-cache 2>&1 | tee -a "$ACTIVE_LOG" || {
    print_error "Docker build failed. Check logs above."
    exit 1
}

print_status "Stopping existing containers..."
docker compose down 2>&1 | tee -a "$ACTIVE_LOG" || print_warning "Some containers may not have been running"

print_status "Starting containers with updated images..."
docker compose up -d 2>&1 | tee -a "$ACTIVE_LOG" || {
    print_error "Failed to start containers. Check logs above."
    exit 1
}

# Wait a moment for containers to start
sleep 5

# Check container status
print_status "Container Status:"
docker compose ps | tee -a "$ACTIVE_LOG"

# Check container health
print_status "Checking container health..."
HEALTH_CHECK_FAILED=0

if ! docker compose ps | grep -q "Up (healthy)"; then
    print_warning "Some containers may not be healthy. Checking logs..."
    docker compose logs --tail=20 | tee -a "$ACTIVE_LOG"
    HEALTH_CHECK_FAILED=1
fi

# Restart Apache (if needed)
print_status "Restarting Apache..."
sudo systemctl restart httpd 2>/dev/null || sudo systemctl restart apache2 2>/dev/null || print_warning "Apache restart failed or not needed"

ACTIVE_LOG=$(get_log_file)
if [ $HEALTH_CHECK_FAILED -eq 0 ]; then
    print_header "Daily Deployment Completed Successfully - $(date)"
    print_status "Deployment log saved to: $ACTIVE_LOG"
    exit 0
else
    print_error "Deployment completed but health checks failed. Please review logs."
    print_status "Deployment log saved to: $ACTIVE_LOG"
    exit 1
fi
