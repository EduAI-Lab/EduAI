# CI/CD Pipeline Documentation

This document describes the GitHub Actions CI pipeline for the Question Maker application.

## Pipeline Overview

The CI pipeline consists of two workflows that run based on branch triggers to ensure code quality and container build validity.

## Branch Strategy

```
feature/* → dev → release
    ↓        ↓       ↓
  lint/test integration CI build validation
```

- **`feature/*`** - Development work (linting + testing)
- **`dev`** - Integration branch (testing)
- **`release`** - Release validation (no deploy from CI)

## Workflow Files

### 1. Feature Branch CI (`feature-ci.yml`)
- **Triggers**: Push to `feature/*` branches, PRs to `dev`
- **Purpose**: Quick feedback on code quality
- **Jobs**:
  - `lint-and-test` - Linting, testing
  - `build-and-test-docker` - Docker build validation (PR only)

### 2. Release Validation (`deploy.yml`)
- **Triggers**: Push to `release` branch, manual trigger
- **Purpose**: Validate images and Compose config (no deploy step)
- **Jobs**:
  - `lint-and-test` - Code quality checks
  - `build-and-test-docker` - Docker validation

### Removed: Production Release (`main.yml`)
- The production workflow was removed. Server-side deployment occurs behind VPN separately from CI.

## Workflow Triggers

| Branch | Workflow | Environment | Purpose |
|--------|----------|-------------|---------|
| `feature/*` | `feature-ci.yml` | CI only | Code quality |
| `dev` | `feature-ci.yml` | CI only | Integration testing |
| `release` | `deploy.yml` | CI only | Build/Compose validation |

## Jobs Description

### Lint and Test Job
- **Purpose**: Code quality enforcement
- **Actions**:
  - ESLint code analysis (if configured)
  - Unit test execution (Jest + Vitest)
  - Dependency caching for performance

### Build and Test Docker Job
- **Purpose**: Container build validation
- **Actions**:
  - Docker image builds
  - Docker Compose configuration validation (Compose V2: `docker compose`)
  - CI-only `.env` creation step for `POSTGRES_PASSWORD_PRODUCTION` using GitHub Secrets

### Deploy Jobs
- Removed from CI. Deployment is handled by a server-side puller (e.g., systemd timer) that periodically pulls the repo and restarts containers behind VPN.

## Required Secrets

Configure these secrets in your GitHub repository settings (as applicable):

### Repository Secrets
- (Optional) `UBC_SERVER_SSH_KEY`: Previously used for SSH deploys (now removed)
- `DATABASE_URL`: Database connection string
- `OPENAI_API_KEY`: OpenAI API key for AI features
- `EDUAI_API_KEY`: EduAI API key for educational AI features
- `PERSONAL_ACCESS_TOKEN`: GitHub Personal Access Token

### Automatic Secrets
- `GITHUB_TOKEN`: Automatically provided by GitHub Actions

## Environment Variables

- `NODE_VERSION`: '20.x' (Node.js version)

## Deployment Process

### Feature Development Flow
1. **Create feature branch**: `git checkout -b feature/new-feature`
2. **Develop and commit**: Make changes, commit to feature branch
3. **Automatic CI**: Linting and testing run automatically
4. **Create PR**: Merge to `dev` branch for integration testing

### Release Validation Flow
1. **Merge to release**: `git checkout release && git merge dev`
2. **Push to release**: `git push origin release`
3. **CI validation**: Lint/tests, Docker builds, and Compose config validation

### Server Deployment (out-of-band)
Deployment occurs on the server via a scheduled puller that compares local vs remote commit and runs `docker compose down && docker compose up -d --build` when changes are detected.

## Monitoring and Debugging

### View Pipeline Status
- GitHub Actions tab in repository
- Individual workflow logs and outputs
- Real-time execution monitoring

### Common Issues
1. **Build Failures**: Check Dockerfile syntax and dependencies
2. **Test Failures**: Review test output and coverage reports
3. **Deployment Issues**: Check server-side puller logs and Docker status
4. **Health Check Failures**: Verify application endpoints and server status

### Log Locations
- **GitHub Actions**: Repository Actions tab
- **Server Logs**: `docker compose logs` on UBC server
- **Container Logs**: Individual service logs via Docker

## Performance Optimizations

- **Dependency Caching**: npm packages cached between runs
- **Docker Layer Caching**: Image layers cached for faster builds
- **Parallel Execution**: Jobs run in parallel where possible
- **Workflow Separation**: Different workflows for different purposes

## Security Considerations

- **Secret Management**: Sensitive data stored in GitHub Secrets (e.g., `POSTGRES_PASSWORD_PRODUCTION` for CI Compose config)
- **SSH Key Rotation**: Regular key updates recommended
- **Dependency Scanning**: Automated vulnerability detection
- **Container Security**: Minimal base images and non-root users

## Rollback Procedures

### Automatic Rollback
- Failed health checks prevent deployment completion
- Previous container versions remain available

### Manual Rollback
On the server, checkout a previous commit and restart containers:
```bash
cd /srv/www/questionmaker.ok.ubc.ca
git checkout [previous-commit]
docker compose down
docker compose up -d
```

## Best Practices

1. **Branch Protection**: Require CI checks before merging to main
2. **Code Reviews**: Mandatory PR reviews for production changes
3. **Testing**: Comprehensive test coverage before deployment
4. **Staging First**: Always test in staging before production
5. **Monitoring**: Regular health check monitoring
6. **Documentation**: Keep deployment docs updated

## Troubleshooting

### Pipeline Failures
1. Check workflow logs for specific error messages
2. Verify secret configurations
3. Test Docker builds locally
4. Validate SSH connectivity

### Deployment Issues
1. Check server resource availability
2. Verify container health status
3. Review application logs
4. Test database connectivity

This pipeline ensures reliable, secure, and automated deployment of the Question Maker application with proper staging and production environments.