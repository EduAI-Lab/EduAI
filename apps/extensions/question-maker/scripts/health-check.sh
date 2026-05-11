#!/bin/bash

# Question Maker - Health Check Monitoring Script
# Monitors container health and application endpoints
# Designed to run via cron job (recommended: every 15 minutes)

set -euo pipefail

# Configuration
PROJECT_DIR="/srv/www/questionmaker.ok.ubc.ca"
LOG_FILE="/var/log/question-maker/health-check.log"
FALLBACK_LOG_FILE="${PROJECT_DIR}/health-check.log"
ALERT_ON_FAILURE=true

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
    log_output "${GREEN}[OK]${NC} $1"
}

print_warning() {
    log_output "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    log_output "${RED}[FAIL]${NC} $1"
}

HEALTH_FAILED=0

log_output "========================================="
log_output "Health Check - $(date)"
log_output "========================================="

# Check Docker containers
log_output ""
log_output "Container Status:"
if command -v docker &> /dev/null; then
    cd "${PROJECT_DIR}" 2>/dev/null || true
    
    # Check if containers are running
    CONTAINERS=$(docker compose ps --format json 2>/dev/null || docker compose ps 2>/dev/null)
    if [ -z "$CONTAINERS" ]; then
        print_error "Could not get container status"
        HEALTH_FAILED=1
    else
        # Check postgres
        if docker ps --format '{{.Names}}' | grep -q "^eduquery-postgres$"; then
            if docker exec eduquery-postgres pg_isready -U postgres >/dev/null 2>&1; then
                print_status "PostgreSQL: Running and ready"
            else
                print_error "PostgreSQL: Running but not ready"
                HEALTH_FAILED=1
            fi
        else
            print_error "PostgreSQL: Container not running"
            HEALTH_FAILED=1
        fi
        
        # Check backend
        if docker ps --format '{{.Names}}' | grep -q "^eduquery-backend$"; then
            if curl -sf http://localhost:8000/healthz >/dev/null 2>&1; then
                print_status "Backend API: Running and healthy"
            else
                print_error "Backend API: Running but health check failed"
                HEALTH_FAILED=1
            fi
        else
            print_error "Backend API: Container not running"
            HEALTH_FAILED=1
        fi
        
        # Check frontend
        if docker ps --format '{{.Names}}' | grep -q "^eduquery-frontend$"; then
            if curl -sf http://localhost:3005/healthz.html >/dev/null 2>&1; then
                print_status "Frontend: Running and healthy"
            else
                print_error "Frontend: Running but health check failed"
                HEALTH_FAILED=1
            fi
        else
            print_error "Frontend: Container not running"
            HEALTH_FAILED=1
        fi
    fi
else
    print_error "Docker command not found"
    HEALTH_FAILED=1
fi

# Check Apache (if accessible)
log_output ""
log_output "Apache Status:"
if systemctl is-active --quiet httpd 2>/dev/null || systemctl is-active --quiet apache2 2>/dev/null; then
    print_status "Apache: Running"
else
    print_warning "Apache: Status unknown (may require sudo to check)"
fi

# Check disk space (quick check)
log_output ""
log_output "Resource Status:"
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "${DISK_USAGE}" -ge 90 ]; then
    print_error "Disk: ${DISK_USAGE}% used (CRITICAL)"
    HEALTH_FAILED=1
elif [ "${DISK_USAGE}" -ge 80 ]; then
    print_warning "Disk: ${DISK_USAGE}% used (WARNING)"
else
    print_status "Disk: ${DISK_USAGE}% used"
fi

# Summary
log_output ""
if [ $HEALTH_FAILED -eq 0 ]; then
    print_status "All health checks passed"
    exit 0
else
    print_error "Health checks failed - review logs above"
    exit 1
fi
