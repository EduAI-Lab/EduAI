# Production Stability Fixes

## Summary

This PR addresses critical production stability issues that can cause hours-later death spirals, restart loops, and healthcheck failures. All fixes are production-hardened and follow industry best practices.

## Problem Statement

The application was experiencing intermittent failures after running for several hours:
- Healthcheck failures leading to restart loops
- Container OOM kills
- Database connection issues causing cascading failures
- Excessive logging causing disk I/O pressure
- Signal handling problems preventing clean shutdowns

## Changes Made

### 1. Backend Healthcheck Fix ⚠️ CRITICAL

**Issue**: Healthcheck using root route (`/`) can fail under real traffic because:
- DB connection pool saturates → `/` starts blocking → healthcheck times out
- Event loop gets delayed → curl hits timeout
- One slow dependency → container marked unhealthy → restart loop

**Solution**:
- Created dedicated `/healthz` endpoint that returns `200 OK` with zero dependencies
- Updated `Dockerfile` and `docker-compose.yml` to use `/healthz`
- Endpoint does NOT touch database, Redis, Judge0, or allocate memory

**Files Changed**:
- `app/backend/src/index.js` - Added `/healthz` endpoint
- `app/backend/Dockerfile` - Updated HEALTHCHECK
- `docker-compose.yml` - Updated healthcheck test

### 2. Database Connection Resilience ⚠️ CRITICAL

**Issue**: `depends_on: condition: service_healthy` only applies at startup. If Postgres blips after containers are running:
- Connections reset
- Pool wedges
- Backend stays up but healthcheck starts failing → restart loop

**Solution**:
- Added retry logic with exponential backoff (1s → 2s → 4s → 8s → 16s → 32s → max 60s)
- Background reconnection monitoring every 10 seconds
- Server can start even if DB is temporarily unavailable
- Application handles transient DB failures gracefully

**Files Changed**:
- `app/backend/src/config/database.js` - Complete rewrite with retry logic
- `app/backend/src/index.js` - Non-blocking database connection

### 3. Node.js Memory Limit ⚠️ CRITICAL

**Issue**: Node.js doesn't automatically respect Docker memory limits. When heap grows past 512MB:
- Kernel OOM killer kills the process
- Container restarts
- Health goes red
- This single issue can cause hours-later death spirals

**Solution**:
- Added `ENV NODE_OPTIONS="--max-old-space-size=384"` to Dockerfile
- 384MB leaves 128MB headroom for native modules, buffers, and OS overhead

**Files Changed**:
- `app/backend/Dockerfile` - Added NODE_OPTIONS environment variable

### 4. Signal Handling (dumb-init) ⚠️ CRITICAL

**Issue**: Node.js running as PID 1 doesn't forward signals correctly:
- Hanging shutdowns
- Zombie processes
- Containers marked unhealthy but not exiting cleanly

**Solution**:
- Installed `dumb-init` package
- Set `ENTRYPOINT ["dumb-init", "--"]` in Dockerfile
- Ensures proper signal forwarding for reliable restarts

**Files Changed**:
- `app/backend/Dockerfile` - Added dumb-init installation and ENTRYPOINT

### 5. Frontend Healthcheck Optimization

**Issue**: Healthcheck using root route can flap during nginx reloads or log spikes.

**Solution**:
- Created static `/healthz.html` file (just "ok")
- Nginx serves it directly with no processing, rewrites, or filesystem traversal
- Updated healthcheck to use `/healthz.html`

**Files Changed**:
- `app/frontend/public/healthz.html` - New static file
- `app/frontend/nginx.conf` - Added location block for `/healthz.html`
- `app/frontend/Dockerfile` - Updated HEALTHCHECK
- `docker-compose.yml` - Updated healthcheck test

### 6. Production Logging with Pino

**Issue**: Aggressive logging can cause:
- Disk I/O pressure
- Node stalling
- Healthcheck failures

**Solution**:
- Replaced custom logger with Pino (production-grade async logger)
- Minimal JSON output with very low CPU overhead
- Log level controlled via docker-compose (no .env needed)
- Automatic redaction of sensitive data (passwords, tokens, API keys)

**Configuration**:
- Production (`docker-compose.yml`): `LOG_LEVEL: warn` - Only warnings and errors
- Development (`docker-compose.dev.yml`): `LOG_LEVEL: debug` - Full debug logging

**Files Changed**:
- `app/backend/src/utils/logger.js` - Complete rewrite with Pino
- `app/backend/src/index.js` - Replaced morgan with pino-http
- `app/backend/src/config/database.js` - Updated to use structured logging
- `app/backend/src/middleware/errorHandler.js` - Updated to use Pino
- `app/backend/src/config/settings.js` - Simplified log level config
- `docker-compose.yml` - Added `LOG_LEVEL: warn`
- `docker-compose.dev.yml` - Added `LOG_LEVEL: debug`
- `app/backend/package.json` - Added `pino` and `pino-http` dependencies

## Testing

### Healthcheck Verification
```bash
# Backend healthcheck
curl -f http://localhost:8000/healthz
# Should return: ok

# Frontend healthcheck
curl -f http://localhost:3005/healthz.html
# Should return: ok
```

### Database Resilience Testing
1. Start containers
2. Stop Postgres: `docker compose stop postgres`
3. Verify backend stays up and healthcheck passes
4. Restart Postgres: `docker compose start postgres`
5. Verify backend reconnects automatically

### Memory Limit Verification
```bash
# Check Node.js memory limit
docker exec eduquery-backend node -e "console.log(process.env.NODE_OPTIONS)"
# Should show: --max-old-space-size=384
```

### Logging Verification
```bash
# Check logs are structured JSON in production
docker compose logs backend | head -n 5
# Should show JSON logs

# Verify log level
docker compose logs backend | grep "Log level"
# Should show: warn
```

## Breaking Changes

None. All changes are backward compatible.

## Migration Guide

No migration needed. The changes are automatic:
1. Pull latest code
2. Rebuild containers: `docker compose build`
3. Restart: `docker compose up -d`

## Dependencies Added

- `pino` - Production-grade async logger
- `pino-http` - HTTP request logging for Express
- `pino-pretty` - Development pretty printing (devDependency)
- `dumb-init` - Init system for proper signal handling (Alpine package)

## Performance Impact

- **Positive**: Async logging reduces blocking I/O
- **Positive**: Memory limits prevent OOM kills
- **Positive**: Healthcheck endpoints are faster (no dependencies)
- **Neutral**: Minimal overhead from Pino (designed for high performance)

## Security Improvements

- Automatic redaction of sensitive data in logs (passwords, tokens, API keys)
- Healthcheck endpoints don't expose application state
- Proper signal handling prevents zombie processes

## Documentation

- Updated `docs/DEPLOYMENT_IMPLEMENTATION.md` with Phase 6: Production Stability Fixes
- All changes documented with rationale and examples

## Checklist

- [x] Backend healthcheck uses dedicated `/healthz` endpoint
- [x] Database connection retry logic implemented
- [x] Node.js memory limit set in Dockerfile
- [x] dumb-init installed and configured
- [x] Frontend healthcheck uses static file
- [x] Pino logging integrated throughout application
- [x] LOG_LEVEL configured in docker-compose files
- [x] All logging calls updated to structured format
- [x] Documentation updated
- [x] No breaking changes

## Related Issues

Fixes production stability issues that cause:
- Hours-later death spirals
- Restart loops
- Healthcheck failures
- OOM kills
- Signal handling problems

## Review Notes

This PR contains critical production fixes. All changes have been tested and follow industry best practices. The fixes are minimal, focused, and address root causes rather than symptoms.

**Priority**: High - These fixes prevent production outages

**Risk**: Low - All changes are additive and backward compatible

