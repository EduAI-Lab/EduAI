# Daily Automated Deployment Setup

This guide explains how to set up automated daily deployments on the remote server.

## Overview

The `daily-deploy.sh` script automatically:
1. Fetches latest changes from `main` branch
2. Pulls changes if updates are available
3. Rebuilds Docker containers with `--no-cache`
4. Restarts all services
5. Verifies container health

## Prerequisites

1. **GitHub Personal Access Token** in `.env` file
2. **GitHub Username** (optional, defaults to `superbolt08`)
3. Script must be executable
4. Cron access on the server

## Setup Instructions

### 1. Add GitHub Token to .env

On the server, edit the `.env` file in the project root:

```bash
cd /srv/www/questionmaker.ok.ubc.ca
nano .env
```

Add one of these (the script checks for all three):
```env
# Option 1
GITHUB_TOKEN=ghp_your_personal_access_token_here

# Option 2
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_personal_access_token_here

# Option 3
PERSONAL_ACCESS_TOKEN=ghp_your_personal_access_token_here
```

**Optional:** Add your GitHub username (defaults to `superbolt08`):
```env
GITHUB_USERNAME=your_github_username
```

### 2. Copy Script to Server

Copy `daily-deploy.sh` to the server:

```bash
# From your local machine
scp daily-deploy.sh [yourcwl]@questionmaker.ok.ubc.ca:/srv/www/questionmaker.ok.ubc.ca/
```

### 3. Make Script Executable

On the server:

```bash
cd /srv/www/questionmaker.ok.ubc.ca
chmod +x daily-deploy.sh
```

### 4. Test the Script Manually

Before setting up cron, test the script:

```bash
cd /srv/www/questionmaker.ok.ubc.ca
./daily-deploy.sh
```

Check the output and verify:
- ✅ Git authentication works
- ✅ Pull succeeds
- ✅ Docker build completes
- ✅ Containers start successfully

### 5. Set Up Cron Job

Edit the crontab:

```bash
crontab -e
```

Add one of these schedules:

**Daily at 2:00 AM:**
```cron
0 2 * * * /srv/www/questionmaker.ok.ubc.ca/daily-deploy.sh >> /var/log/question-maker/cron-deploy.log 2>&1
```

**Daily at 3:00 AM:**
```cron
0 3 * * * /srv/www/questionmaker.ok.ubc.ca/daily-deploy.sh >> /var/log/question-maker/cron-deploy.log 2>&1
```

**Every 12 hours:**
```cron
0 */12 * * * /srv/www/questionmaker.ok.ubc.ca/daily-deploy.sh >> /var/log/question-maker/cron-deploy.log 2>&1
```

**Every 6 hours:**
```cron
0 */6 * * * /srv/www/questionmaker.ok.ubc.ca/daily-deploy.sh >> /var/log/question-maker/cron-deploy.log 2>&1
```

### 6. Verify Cron Job

Check if cron job is scheduled:

```bash
crontab -l
```

### 7. Monitor Logs

View deployment logs:

```bash
# Main log file
tail -f /var/log/question-maker/daily-deploy.log

# Or fallback location
tail -f /srv/www/questionmaker.ok.ubc.ca/daily-deploy.log

# Cron output
tail -f /var/log/question-maker/cron-deploy.log
```

## How It Works

1. **Token Authentication**: Script reads GitHub token from `.env` file
2. **Git Configuration**: Automatically configures git remote URL with token
3. **Smart Checking**: Uses `git fetch` first to check for changes (lightweight)
4. **Conditional Deployment**: Only deploys if changes are detected
5. **Full Rebuild**: Uses `--no-cache` to ensure fresh builds
6. **Health Verification**: Checks container health after deployment

## Security Notes

⚠️ **Important Security Considerations:**

1. **Token Permissions**: GitHub token should have minimal required permissions:
   - ✅ `repo` scope (for private repos)
   - ❌ Don't grant unnecessary scopes

2. **File Permissions**: Ensure `.env` file is not world-readable:
   ```bash
   chmod 600 /srv/www/questionmaker.ok.ubc.ca/.env
   ```

3. **Token Storage**: Token is stored in `.env` file, which should be:
   - Not committed to git (already in `.gitignore`)
   - Protected with proper file permissions
   - Backed up securely

4. **Git Remote URL**: The script modifies git remote URL to include token.
   - This is temporary and only affects authentication
   - Original URL format is preserved in git config

## Troubleshooting

### Script Fails with "GitHub token not found"

**Solution**: Check `.env` file has one of:
- `GITHUB_TOKEN=...`
- `GITHUB_PERSONAL_ACCESS_TOKEN=...`
- `PERSONAL_ACCESS_TOKEN=...`

### Git Authentication Fails

**Solution**: 
1. Verify token is valid and not expired
2. Check token has `repo` scope
3. Verify username is correct

### Cron Job Not Running

**Solution**:
1. Check cron service is running: `sudo systemctl status cron`
2. Verify crontab entry: `crontab -l`
3. Check cron logs: `grep CRON /var/log/syslog`

### Docker Build Fails

**Solution**:
1. Check disk space: `df -h`
2. Check Docker is running: `docker ps`
3. Review build logs in deployment log file

## Manual Execution

You can run the script manually anytime:

```bash
cd /srv/www/questionmaker.ok.ubc.ca
./daily-deploy.sh
```

## Disabling Daily Deployment

To temporarily disable:

```bash
# Comment out the cron line
crontab -e
# Add # at the start of the daily-deploy.sh line
```

To permanently remove:

```bash
crontab -e
# Delete the daily-deploy.sh line
```

## Alternative: Systemd Timer (More Robust)

For a more robust solution, consider using systemd timer instead of cron:

1. Create systemd service file
2. Create systemd timer file
3. Enable and start timer

This provides better logging, error handling, and dependency management.

---

**Last Updated**: December 2024  
**Script**: `daily-deploy.sh`  
**Log Location**: `/var/log/question-maker/daily-deploy.log`
