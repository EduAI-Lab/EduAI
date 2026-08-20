# Build context: monorepo root
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS workspace

WORKDIR /app

# Both dependency stages install from the committed monorepo lockfile. Only the
# manifests for this service and its shared types workspace are needed for npm's
# workspace graph.
COPY package.json package-lock.json .npmrc ./
COPY packages/types/package.json ./packages/types/
COPY apps/extensions/question-maker/app/backend/package.json \
     ./apps/extensions/question-maker/app/backend/

FROM workspace AS build

COPY packages/types/tsconfig.json ./packages/types/
COPY packages/types/src           ./packages/types/src

RUN npm ci --ignore-scripts \
      --workspace=@eduai/types \
      --include-workspace-root=false \
    && npm run build --workspace=@eduai/types

FROM workspace AS production-deps

COPY apps/extensions/question-maker/app/backend/prisma \
     ./apps/extensions/question-maker/app/backend/prisma
COPY --from=build /app/packages/types/dist ./packages/types/dist

# Prisma is a runtime dependency because the container applies migrations on
# startup. The selected-workspace install excludes every development tool.
RUN npm ci --ignore-scripts --omit=dev \
      --workspace=question-maker-backend \
      --include-workspace-root=false \
    && ./node_modules/.bin/prisma generate \
      --schema=apps/extensions/question-maker/app/backend/prisma/schema.prisma

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS serve
WORKDIR /app

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/packages/types ./packages/types
COPY --from=production-deps /app/apps/extensions/question-maker/app/backend/node_modules \
     ./apps/extensions/question-maker/app/backend/node_modules

# Install curl for health checks and dumb-init for proper signal handling
RUN apk add --no-cache curl dumb-init
COPY apps/extensions/question-maker/app/backend/src     ./apps/extensions/question-maker/app/backend/src
COPY apps/extensions/question-maker/app/backend/scripts ./apps/extensions/question-maker/app/backend/scripts
COPY apps/extensions/question-maker/app/backend/prisma  ./apps/extensions/question-maker/app/backend/prisma
COPY apps/extensions/question-maker/app/backend/package.json ./apps/extensions/question-maker/app/backend/

ENV PATH="/app/apps/extensions/question-maker/app/backend/node_modules/.bin:/app/node_modules/.bin:${PATH}"

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs
WORKDIR /app/apps/extensions/question-maker/app/backend

# Expose port
EXPOSE 8000

# Set Node.js memory limit to prevent OOM kills
# 384MB leaves headroom for native modules, buffers, and OS overhead within 512MB container limit
ENV NODE_OPTIONS="--max-old-space-size=384"

# Health check with better error handling
# Uses curl which is more reliable and has proper timeout handling
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8000/readyz || exit 1

# Use dumb-init to properly forward signals to Node.js
# This prevents hanging shutdowns and zombie processes when running as PID 1
ENTRYPOINT ["dumb-init", "--"]

# Baseline a pre-existing (Sequelize-managed) database if needed, apply pending
# migrations, then start the application. See scripts/baselineExistingDatabase.js.
# Compose passes the database password separately so reserved URL characters do
# not corrupt DATABASE_URL. Node's URL serializer percent-encodes it without
# writing the resulting credential to logs.
CMD ["sh", "-c", "if [ -n \"${POSTGRES_PASSWORD:-}\" ]; then qm_database_url=\"$(node -e 'const url = new URL(process.env.DATABASE_URL); url.password = process.env.POSTGRES_PASSWORD; process.stdout.write(url.href)')\" || exit 1; export DATABASE_URL=\"$qm_database_url\"; fi; node scripts/baselineExistingDatabase.js && prisma migrate deploy && exec node src/index.js"]
