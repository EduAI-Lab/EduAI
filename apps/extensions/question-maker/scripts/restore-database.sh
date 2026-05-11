#!/bin/bash

# Question Maker - Database Restore Script
# Restores database from a backup file
# Usage: ./restore-database.sh <backup-file.sql.gz>

set -euo pipefail

# Configuration
CONTAINER_NAME="eduquery-postgres"
DATABASE_NAME="eduquery"
DATABASE_USER="postgres"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ $# -eq 0 ]; then
    echo -e "${RED}Error:${NC} No backup file specified"
    echo "Usage: $0 <backup-file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lh backups/eduquery_backup_*.sql.gz 2>/dev/null | tail -5 || echo "  No backups found"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Error:${NC} Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}Error:${NC} Container ${CONTAINER_NAME} is not running"
    exit 1
fi

echo -e "${YELLOW}WARNING:${NC} This will replace the current database with the backup!"
echo -e "Backup file: ${BACKUP_FILE}"
echo -e "Database: ${DATABASE_NAME}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled"
    exit 0
fi

echo ""
echo -e "${GREEN}Restoring database...${NC}"

# Determine if file is compressed
if [[ "$BACKUP_FILE" == *.gz ]]; then
    # Compressed backup
    gunzip -c "$BACKUP_FILE" | docker exec -i "${CONTAINER_NAME}" psql -U "${DATABASE_USER}" -d "${DATABASE_NAME}"
else
    # Uncompressed backup
    docker exec -i "${CONTAINER_NAME}" psql -U "${DATABASE_USER}" -d "${DATABASE_NAME}" < "$BACKUP_FILE"
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Database restored successfully!${NC}"
    exit 0
else
    echo -e "${RED}Database restore failed!${NC}"
    exit 1
fi
