# Question Maker Deployment Guide

## Quick Start: Push to Production

**Before you start:** Make sure you've committed and pushed your changes to the `main` branch from your local machine:
```bash
git add .
git commit -m "Your commit message"
git push origin main
```

**Then on the server, follow these 3 steps:**

1. **SSH to the server:**
   ```bash
   ssh [yourcwl]@questionmaker.ok.ubc.ca

   <!-- Example -->
   ssh ssaada08@questionmaker.ok.ubc.ca
   ```
   *Note: Connect to UBC VPN first if not on campus*

2. **Navigate to the repository:**
   ```bash
   cd /srv/www/questionmaker.ok.ubc.ca
   ```

3. **After pulling, you can then run:**
   ```bash
   git pull origin main
   docker compose build --no-cache
   docker compose down
   docker compose up -d
   ```

The script will automatically:
- Check for updates from the `main` branch
- Pull the latest changes
- Rebuild Docker containers
- Restart services
- Verify deployment health

**View deployment logs:** `tail -f /var/log/question-maker/deploy.log`

---

This guide provides step-by-step instructions for deploying the Question Maker application using Docker on UBC servers.

## Prerequisites

- Linux server with sudo access
- Domain name (e.g., yourapp.ok.ubc.ca)
- Git repository access
- **UBC VPN connection** (use `myvpn.ok.ubc.ca` for Okanagan campus)
- **Personal Access Token** for GitHub (passwords no longer work for Git operations)
- Docker and Docker Compose installed

## CI/CD Pipeline

The Question Maker application uses GitHub Actions for automated testing and deployment.

### Automatic Deployment

**Triggers:**
- ✅ **Push to `deploy` branch** - Automatically deploys to staging
- ✅ **Push to `main` branch** - Automatically deploys to production
- ✅ **Pull requests** - Runs tests and Docker builds (no deployment)

### Manual Deployment

**Option 1: GitHub Actions UI**
1. Go to your repository on GitHub
2. Click **Actions** tab
3. Select **CI/CD Pipeline** workflow
4. Click **Run workflow** button
5. Select branch and click **Run workflow**

**Option 2: Command Line**
```bash
# Push to staging (deploy branch)
git push origin deploy

# Push to production (main branch)
git push origin main

# Or create a new commit to trigger deployment
git add .
git commit -m "Deploy latest changes"
git push origin deploy  # or main
```

### Required GitHub Secrets

Add these secrets in GitHub repository settings:

1. **`UBC_SERVER_SSH_KEY`** - Your SSH private key for server access
   - Generate: `ssh-keygen -t rsa -b 4096 -C "your_email@example.com"`
   - Copy private key content to GitHub secret

2. **`DATABASE_URL`** - Database connection string
   - Format: `postgresql://postgres:password@postgres:5432/eduquery`

3. **`OPENAI_API_KEY`** - OpenAI API key for AI features

4. **`EDUAI_API_KEY`** - EduAI API key for educational AI features
   - EduAI renews this key about every month. Update the value in GitHub secrets, the server `.env`, and your local `.env` when it changes, or EduAI-powered features will stop. Longer-term notes: [Future work](../FUTURE_WORK.md).

5. **`PERSONAL_ACCESS_TOKEN`** - GitHub Personal Access Token
   - For Git operations and API access

### Pipeline Jobs

1. **`feature-ci.yml`** - Feature branch linting and testing
2. **`deploy.yml`** - Deploy branch (staging deployment)
3. **`main.yml`** - Main branch (production deployment)

### Monitoring Deployments

- **GitHub Actions**: View deployment status in Actions tab
- **Server Logs**: SSH to server and run `docker compose logs`
- **Health Checks**: Pipeline automatically tests endpoints after deployment

## Server-Side Auto-Deployment

The server automatically checks for updates on the `main` branch and deploys when changes are detected.

### How It Works

- **Polling**: Systemd timer runs every 5 minutes
- **Smart Checking**: Uses `git fetch` to check for updates (lightweight)
- **Efficient**: Only deploys when changes are detected
- **Automatic**: Rebuilds Docker images and restarts containers

### Setup

1. **Copy systemd files to server:**
   ```bash
   sudo cp question-maker-deploy.service /etc/systemd/system/
   sudo cp question-maker-deploy.timer /etc/systemd/system/
   ```

2. **Make script executable:**
   ```bash
   chmod +x /srv/www/questionmaker.ok.ubc.ca/pull-and-deploy.sh
   ```

3. **Enable and start timer:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable question-maker-deploy.timer
   sudo systemctl start question-maker-deploy.timer
   ```

### Monitoring

- **Check timer status**: `sudo systemctl status question-maker-deploy.timer`
- **View deployment logs**: `tail -f /var/log/question-maker/deploy.log`
- **View service logs**: `sudo journalctl -u question-maker-deploy.service -f`

### Manual Deployment Trigger

To manually trigger deployment without waiting for the timer:
```bash
cd /srv/www/questionmaker.ok.ubc.ca
./pull-and-deploy.sh
```

## SSH Connection

### 1. Connect to UBC Server

```bash
# Connect to UBC VPN first (if not on campus)
# Then SSH to your server
ssh ssaada08@questionmaker.ok.ubc.ca

# Navigate to project directory
cd /srv/www/questionmaker.ok.ubc.ca
```

**Important Notes:**
- Use **PowerShell** instead of WSL for UBC servers
- Must be connected to UBC network (VPN or campus)
- Use your UBC credentials for SSH

## Quick Start

### 1. Server Setup

```bash
# Install Docker and Docker Compose
sudo dnf install -y docker docker-compose

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
```

### 2. Clone Repository

```bash
# Navigate to web directory
cd /srv/www/questionmaker.ok.ubc.ca

# Clone repository
git clone https://github.com/question-maker-org/question-maker.git .

# Update ownership and permissions
sudo chown -R $USER:questionmaker /srv/www/questionmaker.ok.ubc.ca
sudo chmod -R 755 /srv/www/questionmaker.ok.ubc.ca
```

### 3. Environment Configuration

```bash
# Create environment file
cp env.production.template .env
nano .env
```

**Required Environment Variables:**
```env
DATABASE_URL=postgresql://postgres:your_password@postgres:5432/eduquery
```

### 4. Apache Configuration

```bash
# Create Apache configuration
sudo nano /etc/httpd/conf.d/question-maker.conf
```

**Apache Configuration:**
```apache
# Handle API routes - proxy to backend (MUST come first)
<LocationMatch "^/api/">
    ProxyPass http://localhost:8000
    ProxyPassReverse http://localhost:8000
    ProxyPreserveHost On
    Require all granted
</LocationMatch>

# Handle all other requests - send to frontend (includes /help, /login, /home, etc.)
# This regex matches everything EXCEPT /api/ routes
<LocationMatch "^(?!\/api\/).*">
    ProxyPass http://localhost:3005
    ProxyPassReverse http://localhost:3005
    ProxyPreserveHost On
    Require all granted
</LocationMatch>
```

```bash
# Test and restart Apache
sudo httpd -t
sudo systemctl restart httpd
```

### 5. Deploy with Docker

```bash
# Start all services
docker compose up -d

# Check status
docker compose ps

# View logs if needed
docker compose logs frontend
docker compose logs backend
```

## Verification

After deployment, verify:

```bash
# Test local endpoints
curl -f http://localhost:3005/    # Frontend
curl -f http://localhost:8000/    # Backend API

# Test through Apache
curl -f http://questionmaker.ok.ubc.ca/
curl -f http://questionmaker.ok.ubc.ca/api/
```

## Architecture Overview

```
Internet → Apache (Reverse Proxy) → Docker Containers
                                    ├── Frontend (Nginx + React) - Port 3005
                                    ├── Backend (Node.js API) - Port 8000
                                    └── Database (PostgreSQL) - Port 55432
```

## Troubleshooting

### Common Issues

1. **"Service Unavailable" Error**
   - Check if containers are running: `docker compose ps`
   - Check Apache error logs: `sudo tail -f /var/log/httpd/error_log`
   - Verify Apache configuration: `sudo httpd -t`

2. **Port Conflicts**
   - Check what's using ports: `sudo netstat -tlnp | grep :3005`
   - Change port in docker-compose.yml if needed
   - Update Apache configuration to match

3. **CORS Errors**
   - Ensure frontend uses relative URLs (`/api` not `http://localhost:8000`)
   - Check Apache is properly routing `/api/*` to backend

4. **403 Forbidden Errors on Routes (e.g., /help)**
   - Check Apache configuration at `/etc/httpd/conf.d/question-maker.conf`
   - Ensure `Require all granted` is present in LocationMatch blocks
   - Verify the regex pattern `^(?!\/api\/).*` matches your route
   - Check Apache error logs: `sudo tail -f /var/log/httpd/error_log`
   - Test Apache config: `sudo httpd -t`
   - Restart Apache: `sudo systemctl restart httpd`
   - **Nginx redirect issue**: If nginx is returning 301 redirects (e.g., `/help` → `/help/`), check `app/frontend/nginx.conf`:
     - Ensure `absolute_redirect off;` is set to prevent absolute redirect URLs
     - Use `try_files $uri /index.html;` instead of `try_files $uri $uri/ /index.html;` to prevent automatic trailing slash redirects
     - Rebuild frontend container: `docker compose build frontend && docker compose up -d frontend`

5. **Container Issues**
   - View container logs: `docker compose logs [service-name]`
   - Restart containers: `docker compose restart`
   - Rebuild if needed: `docker compose build`

6. **502 on OCR / document extraction (works on dev, fails on production)**
   - **Cause:** OCR extraction calls EduAI and can take 2–5+ minutes. The reverse proxy (Apache) often uses a 60s default timeout and closes the connection before the backend responds, so you get 502 Bad Gateway.
   - **Fix:** Increase the proxy timeout for API routes. On the server, edit the Apache config:
     ```bash
     sudo nano /etc/httpd/conf.d/question-maker.conf
     ```
     Inside the `<LocationMatch "^/api/">` block, add:
     ```apache
     ProxyTimeout 300
     ```
     (300 seconds = 5 minutes). Then test and restart:
     ```bash
     sudo httpd -t
     sudo systemctl restart httpd
     ```
   - The repo’s `apache-vhost.conf` template includes `ProxyTimeout 300`; if you deploy from that template, new installs get the longer timeout. Existing servers need the directive added and Apache restarted.

### Useful Commands

```bash
# Docker Management
docker compose up -d              # Start all services
docker compose down              # Stop all services
docker compose ps                # Check status
docker compose logs -f           # Follow logs
docker compose restart frontend  # Restart specific service

# Apache Management
sudo httpd -t                    # Test configuration
sudo systemctl restart httpd     # Restart Apache
sudo tail -f /var/log/httpd/error_log  # View error logs

# Testing
curl -f http://localhost:3005/   # Test frontend
curl -f http://localhost:8000/  # Test backend
curl -f http://questionmaker.ok.ubc.ca/  # Test website
```

## Important Notes

1. **Port Configuration**: 
   - Frontend: 3005 (external) → 80 (internal)
   - Backend: 8000
   - Database: 55432 (external) → 5432 (internal)

2. **File Structure**: 
   - Docker Compose file in project root
   - Environment variables in `.env` file
   - Apache configuration in `/etc/httpd/conf.d/`

3. **SSH Access**: 
   - Use PowerShell instead of WSL for UBC servers
   - Must be connected to UBC network (VPN or campus)

4. **Git Authentication**: 
   - Use Personal Access Token, not password
   - Create token at: GitHub → Settings → Developer settings

## Security Considerations

- Containers run with non-root users
- Only necessary ports are exposed
- Internal communication uses Docker network
- Apache handles SSL termination (when certificates are configured)

## Performance Optimization

- Frontend served by Nginx with caching headers
- Static assets compressed with Gzip
- Database connection pooling
- Container health checks (when working)

## Seeding sample questions on production

To add the same topics and sample questions as development to every existing course **without** wiping data (production-safe), run the seed **inside the backend container** so it can reach Postgres on the Docker network:

```bash
cd /srv/www/questionmaker.ok.ubc.ca
docker compose run --rm backend node scripts/seedProductionQuestions.js
```

This uses the same `DATABASE_URL` as the app (host `postgres`), so it works even when Postgres is not published to the host. Ensure containers are up (`docker compose up -d`) before running.

**Alternative (host):** If Postgres is published to the host (e.g. `55432:5432`) and the stack is running, you can run from the project root: `npm run seed:production`. If you get connection refused, use the `docker compose run` command above.

Do **not** use `npm run populate` in production—it clears all data first.

## Backup and Recovery

```bash
# Database backup
docker exec eduquery-postgres pg_dump -U postgres eduquery > backup.sql

# Restore database
docker exec -i eduquery-postgres psql -U postgres eduquery < backup.sql

# Configuration backup
cp docker-compose.yml docker-compose.yml.backup
cp .env .env.backup
sudo cp /etc/httpd/conf.d/question-maker.conf question-maker.conf.backup
```

---

**For detailed implementation history, see [DEPLOYMENT_IMPLEMENTATION.md](./DEPLOYMENT_IMPLEMENTATION.md)**  
**For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md)**  
**For planned improvements (plain language), see [Future work](../FUTURE_WORK.md)**
