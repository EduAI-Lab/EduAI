# Production Monitoring Setup Guide

This guide explains how to set up automated monitoring, backups, and health checks for the Question Maker production environment.

## Overview

The monitoring system consists of:
1. **Automated Database Backups** - Daily backups with 7-day retention
2. **Disk Space Monitoring** - Alerts when disk usage exceeds thresholds
3. **Health Check Monitoring** - Monitors container and application health
4. **Restore Script** - Easy database restoration from backups

## Prerequisites

- Scripts must be executable
- Cron access on the server
- Docker containers running
- Log directory writable (or fallback to project directory)

## Setup Instructions

### 1. Copy Scripts to Server

Copy all scripts from `scripts/` directory to the server:

```bash
# From your local machine (PowerShell)
cd "C:\Users\SyedS\Documents\UBCO Courses\honors\question-maker"
scp scripts\*.sh [yourcwl]@questionmaker.ok.ubc.ca:/srv/www/questionmaker.ok.ubc.ca/scripts/
```

**Note**: After copying, fix Windows line endings on the server:
```bash
# On the server
cd /srv/www/questionmaker.ok.ubc.ca/scripts
sed -i 's/\r$//' *.sh
chmod +x *.sh
```

### 2. Make Scripts Executable

On the server:

```bash
cd /srv/www/questionmaker.ok.ubc.ca/scripts
chmod +x *.sh
```

### 3. Create Log Directory

```bash
sudo mkdir -p /var/log/question-maker
sudo chown $USER:$USER /var/log/question-maker
```

### 4. Set Up Cron Jobs

Edit crontab:

```bash
crontab -e
```

Add these entries (adjust times as needed):

```cron
# Database backup - Daily at 1 AM (before daily deployment at 2 AM)
0 1 * * * /srv/www/questionmaker.ok.ubc.ca/scripts/backup-database.sh >> /var/log/question-maker/cron-backup.log 2>&1

# Disk space monitoring - Every 6 hours
0 */6 * * * /srv/www/questionmaker.ok.ubc.ca/scripts/monitor-disk-space.sh >> /var/log/question-maker/cron-disk.log 2>&1

# Health check - Every 15 minutes
*/15 * * * * /srv/www/questionmaker.ok.ubc.ca/scripts/health-check.sh >> /var/log/question-maker/cron-health.log 2>&1
```

### 5. Verify Cron Jobs

```bash
crontab -l
```

## Script Details

### backup-database.sh

**Purpose**: Creates compressed database backups with automatic cleanup

**Features**:
- Creates timestamped backups: `eduquery_backup_YYYYMMDD_HHMMSS.sql.gz`
- Automatic retention (keeps 7 days by default)
- Verifies backup integrity
- Logs all operations

**Configuration**:
- `BACKUP_DIR`: Where backups are stored (default: `$PROJECT_DIR/backups`)
- `RETENTION_DAYS`: How many days to keep backups (default: 7)

**Manual Execution**:
```bash
cd /srv/www/questionmaker.ok.ubc.ca
./scripts/backup-database.sh
```

**View Backups**:
```bash
ls -lh /srv/www/questionmaker.ok.ubc.ca/backups/
```

### monitor-disk-space.sh

**Purpose**: Monitors disk usage and alerts when thresholds are exceeded

**Features**:
- Checks root filesystem usage
- Monitors Docker disk usage
- Tracks backup directory size
- Provides cleanup recommendations

**Thresholds**:
- **Warning**: 80% disk usage
- **Critical**: 90% disk usage

**Exit Codes**:
- `0`: Healthy
- `1`: Warning threshold exceeded
- `2`: Critical threshold exceeded

**Manual Execution**:
```bash
cd /srv/www/questionmaker.ok.ubc.ca
./scripts/monitor-disk-space.sh
```

### health-check.sh

**Purpose**: Monitors container and application health

**Checks**:
- PostgreSQL container status and readiness
- Backend API health endpoint
- Frontend health endpoint
- Apache service status
- Disk space usage

**Exit Codes**:
- `0`: All checks passed
- `1`: One or more checks failed

**Manual Execution**:
```bash
cd /srv/www/questionmaker.ok.ubc.ca
./scripts/health-check.sh
```

### restore-database.sh

**Purpose**: Restores database from a backup file

**Usage**:
```bash
cd /srv/www/questionmaker.ok.ubc.ca
./scripts/restore-database.sh backups/eduquery_backup_20260126_010000.sql.gz
```

**Safety**:
- Requires confirmation before restoring
- Lists available backups if no file specified
- Validates backup file exists

## Monitoring Logs

### View Logs

```bash
# Database backups
tail -f /var/log/question-maker/backup.log

# Disk monitoring
tail -f /var/log/question-maker/disk-monitor.log

# Health checks
tail -f /var/log/question-maker/health-check.log

# Cron output
tail -f /var/log/question-maker/cron-*.log
```

### Log Locations

- Primary: `/var/log/question-maker/`
- Fallback: `/srv/www/questionmaker.ok.ubc.ca/` (if primary not writable)

## Backup Management

### List Backups

```bash
ls -lh /srv/www/questionmaker.ok.ubc.ca/backups/
```

### Manual Backup

```bash
cd /srv/www/questionmaker.ok.ubc.ca
./scripts/backup-database.sh
```

### Restore from Backup

```bash
cd /srv/www/questionmaker.ok.ubc.ca
./scripts/restore-database.sh backups/eduquery_backup_YYYYMMDD_HHMMSS.sql.gz
```

### Clean Up Old Backups

Backups older than 7 days are automatically deleted. To manually clean:

```bash
# Remove backups older than 7 days
find /srv/www/questionmaker.ok.ubc.ca/backups -name "eduquery_backup_*.sql.gz" -mtime +7 -delete

# Or adjust retention in backup-database.sh
```

## Alerting (Future Enhancement)

Currently, scripts log issues but don't send alerts. To add email alerts:

1. Install mail client: `sudo dnf install mailx` (or `postfix`)
2. Configure email in scripts
3. Add email sending on critical failures

Example email alert (to be added):
```bash
if [ $HEALTH_FAILED -eq 1 ]; then
    echo "Health check failed at $(date)" | mail -s "Question Maker Health Alert" admin@example.com
fi
```

## Troubleshooting

### Scripts Not Running

1. Check cron service: `sudo systemctl status crond`
2. Verify crontab: `crontab -l`
3. Check cron logs: `grep CRON /var/log/syslog`

### Permission Errors

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Fix log directory permissions
sudo mkdir -p /var/log/question-maker
sudo chown $USER:$USER /var/log/question-maker
```

### Backup Failures

1. Check container is running: `docker ps | grep postgres`
2. Check disk space: `df -h`
3. Verify backup directory exists and is writable
4. Review backup log: `tail -f /var/log/question-maker/backup.log`

### Health Check Failures

1. Check container status: `docker compose ps`
2. Test endpoints manually:
   ```bash
   curl http://localhost:8000/healthz
   curl http://localhost:3005/healthz.html
   ```
3. Review container logs: `docker compose logs`

## Best Practices

1. **Test Scripts Manually First**: Run each script manually before setting up cron
2. **Monitor Logs Regularly**: Check logs weekly for issues
3. **Verify Backups**: Periodically test restore process
4. **Adjust Thresholds**: Tune disk space thresholds based on your usage
5. **Review Retention**: Adjust backup retention based on storage capacity

## Integration with Daily Deployments

The monitoring system is designed to work alongside daily deployments:

- **1:00 AM**: Database backup runs
- **2:00 AM**: Daily deployment runs (can use fresh backup if needed)
- **Every 15 minutes**: Health checks run
- **Every 6 hours**: Disk space monitoring

This ensures backups are created before deployments, and health is monitored throughout the day.

---

**Last Updated**: January 26, 2026  
**Status**: ✅ All scripts deployed and verified on production server  
**Scripts Location**: `/srv/www/questionmaker.ok.ubc.ca/scripts/`  
**Logs Location**: `/var/log/question-maker/`  
**Backups Location**: `/srv/www/questionmaker.ok.ubc.ca/backups/`
