#!/bin/bash

# Question Maker - Automated Database Backup Script
# Creates daily backups of PostgreSQL database with retention policy
# Designed to run via cron job (recommended: daily at 1 AM, before daily-deploy.sh at 2 AM)

set -euo pipefail

# Configuration
PROJECT_DIR="/srv/www/questionmaker.ok.ubc.ca"
BACKUP_DIR="${PROJECT_DIR}/backups"
CONTAINER_NAME="eduquery-postgres"
DATABASE_NAME="eduquery"
DATABASE_USER="postgres"
RETENTION_DAYS=7  # Keep backups for 7 days
LOG_FILE="/var/log/question-maker/backup.log"
FALLBACK_LOG_FILE="${PROJECT_DIR}/backup.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    log_output "${RED}[ERROR]${NC} $1"
}

print_header() {
    log_output "${BLUE}========================================${NC}"
    log_output "${BLUE}$1${NC}"
    log_output "${BLUE}========================================${NC}"
}

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR" || {
    print_error "Failed to create backup directory: $BACKUP_DIR"
    exit 1
}

# Check if container exists and is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    print_error "Container ${CONTAINER_NAME} is not running"
    exit 1
fi

print_header "Database Backup Started - $(date)"

# Generate backup filename with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/eduquery_backup_${TIMESTAMP}.sql"
BACKUP_FILE_COMPRESSED="${BACKUP_FILE}.gz"

print_status "Creating backup: ${BACKUP_FILE_COMPRESSED}"

# Create database backup
if docker exec "${CONTAINER_NAME}" pg_dump -U "${DATABASE_USER}" -d "${DATABASE_NAME}" --clean --if-exists 2>/dev/null | gzip > "${BACKUP_FILE_COMPRESSED}"; then
    BACKUP_SIZE=$(du -h "${BACKUP_FILE_COMPRESSED}" | cut -f1)
    print_status "Backup created successfully: ${BACKUP_SIZE}"
    
    # Verify backup file exists and is not empty
    if [ ! -s "${BACKUP_FILE_COMPRESSED}" ]; then
        print_error "Backup file is empty! Removing invalid backup..."
        rm -f "${BACKUP_FILE_COMPRESSED}"
        exit 1
    fi
    
    print_status "Backup verified: ${BACKUP_FILE_COMPRESSED}"
else
    print_error "Backup failed!"
    exit 1
fi

# Clean up old backups (retention policy)
print_status "Cleaning up backups older than ${RETENTION_DAYS} days..."
DELETED_COUNT=$(find "${BACKUP_DIR}" -name "eduquery_backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "${DELETED_COUNT}" -gt 0 ]; then
    print_status "Deleted ${DELETED_COUNT} old backup(s)"
else
    print_status "No old backups to delete"
fi

# List current backups
REMAINING_BACKUPS=$(find "${BACKUP_DIR}" -name "eduquery_backup_*.sql.gz" -type f | wc -l)
print_status "Total backups retained: ${REMAINING_BACKUPS}"

# Calculate total backup size
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
print_status "Total backup storage: ${TOTAL_SIZE}"

print_header "Database Backup Completed Successfully - $(date)"

exit 0
