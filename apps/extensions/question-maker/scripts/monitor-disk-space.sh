#!/bin/bash

# Question Maker - Disk Space Monitoring Script
# Monitors disk usage and alerts if space is running low
# Designed to run via cron job (recommended: every 6 hours)

set -euo pipefail

# Configuration
WARNING_THRESHOLD=80  # Alert when disk usage exceeds 80%
CRITICAL_THRESHOLD=90 # Alert when disk usage exceeds 90%
PROJECT_DIR="/srv/www/questionmaker.ok.ubc.ca"
LOG_FILE="/var/log/question-maker/disk-monitor.log"
FALLBACK_LOG_FILE="${PROJECT_DIR}/disk-monitor.log"
ALERT_EMAIL=""  # Set this if you want email alerts (requires mail setup)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Function to log output
log_output() {
    local log_file="${LOG_FILE}"
    if [ ! -w "$(dirname "$log_file")" ] 2>/dev/null; then
        log_file="${FALLBACK_LOG_FILE}"
    fi
    
    if [ -w "$(dirname "$log_file")" ] 2>/dev/null || mkdir -p "$(dirname "$log_file")" 2>/dev/null; then
        echo -e "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$log_file" 2>/dev/null || echo -e "$1"
    else
        echo -e "$1"
    fi
}

print_status() {
    log_output "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    log_output "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    log_output "${RED}[CRITICAL]${NC} $1"
}

# Get disk usage for root filesystem
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
DISK_AVAILABLE=$(df -h / | awk 'NR==2 {print $4}')
DISK_TOTAL=$(df -h / | awk 'NR==2 {print $2}')
DISK_USED=$(df -h / | awk 'NR==2 {print $3}')

# Get Docker disk usage
DOCKER_USAGE=$(docker system df --format '{{.Size}}' 2>/dev/null || echo "N/A")

# Get backup directory size (if exists)
BACKUP_SIZE="N/A"
if [ -d "${PROJECT_DIR}/backups" ]; then
    BACKUP_SIZE=$(du -sh "${PROJECT_DIR}/backups" 2>/dev/null | cut -f1 || echo "N/A")
fi

# Log current status
log_output "========================================="
log_output "Disk Space Check - $(date)"
log_output "========================================="
log_output "Root Filesystem:"
log_output "  Usage: ${DISK_USAGE}%"
log_output "  Available: ${DISK_AVAILABLE}"
log_output "  Used: ${DISK_USED} / ${DISK_TOTAL}"
log_output "Docker Usage: ${DOCKER_USAGE}"
log_output "Backup Size: ${BACKUP_SIZE}"

# Check thresholds
if [ "${DISK_USAGE}" -ge "${CRITICAL_THRESHOLD}" ]; then
    print_error "CRITICAL: Disk usage is ${DISK_USAGE}% (threshold: ${CRITICAL_THRESHOLD}%)"
    print_error "Only ${DISK_AVAILABLE} available on root filesystem!"
    
    # Suggest cleanup actions
    log_output ""
    log_output "RECOMMENDED ACTIONS:"
    log_output "1. Clean up Docker: docker system prune -a --volumes"
    log_output "2. Remove old backups: find ${PROJECT_DIR}/backups -name '*.sql.gz' -mtime +7 -delete"
    log_output "3. Check log files: docker compose logs --tail=100"
    log_output "4. Remove old Docker images: docker image prune -a"
    
    exit 2  # Critical exit code
elif [ "${DISK_USAGE}" -ge "${WARNING_THRESHOLD}" ]; then
    print_warning "WARNING: Disk usage is ${DISK_USAGE}% (threshold: ${WARNING_THRESHOLD}%)"
    print_warning "Only ${DISK_AVAILABLE} available on root filesystem"
    
    # Suggest preventive actions
    log_output ""
    log_output "PREVENTIVE ACTIONS:"
    log_output "1. Review backup retention: ${PROJECT_DIR}/backups"
    log_output "2. Clean up Docker unused resources: docker system prune"
    
    exit 1  # Warning exit code
else
    print_status "Disk space is healthy: ${DISK_USAGE}% used, ${DISK_AVAILABLE} available"
    exit 0
fi
