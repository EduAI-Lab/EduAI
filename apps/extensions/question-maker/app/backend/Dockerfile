# Build context: monorepo root
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY packages/types/package.json  ./packages/types/
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/types/src           ./packages/types/src
COPY apps/core/package.json                                   ./apps/core/
COPY apps/extensions/ai-tutor/package.json                    ./apps/extensions/ai-tutor/
COPY apps/extensions/ai-tutor/server/package.json             ./apps/extensions/ai-tutor/server/
COPY apps/extensions/question-maker/package.json              ./apps/extensions/question-maker/
COPY apps/extensions/question-maker/app/backend/package.json  ./apps/extensions/question-maker/app/backend/
COPY apps/extensions/question-maker/app/frontend/package.json ./apps/extensions/question-maker/app/frontend/

RUN npm ci --ignore-scripts \
     && npm run build -w @eduai/types \
     && mkdir -p apps/extensions/question-maker/app/backend/node_modules/@eduai \
     && ln -s /app/packages/types apps/extensions/question-maker/app/backend/node_modules/@eduai/types \
     && cd apps/extensions/question-maker/app/backend \
     && npm install --ignore-scripts --no-package-lock --workspaces=false

FROM node:24-alpine AS serve
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/types ./packages/types
COPY --from=deps /app/apps/extensions/question-maker/app/backend/node_modules \
     ./apps/extensions/question-maker/app/backend/node_modules

# Install curl for health checks and dumb-init for proper signal handling
RUN apk add --no-cache curl dumb-init
COPY apps/extensions/question-maker/app/backend/src     ./apps/extensions/question-maker/app/backend/src
COPY apps/extensions/question-maker/app/backend/scripts ./apps/extensions/question-maker/app/backend/scripts
COPY apps/extensions/question-maker/app/backend/prisma  ./apps/extensions/question-maker/app/backend/prisma
COPY apps/extensions/question-maker/app/backend/package.json ./apps/extensions/question-maker/app/backend/

ENV PATH="/app/apps/extensions/question-maker/app/backend/node_modules/.bin:/app/node_modules/.bin:${PATH}"

RUN npx prisma generate --schema=apps/extensions/question-maker/app/backend/prisma/schema.prisma

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
  CMD curl -f http://localhost:8000/healthz || exit 1

# Use dumb-init to properly forward signals to Node.js
# This prevents hanging shutdowns and zombie processes when running as PID 1
ENTRYPOINT ["dumb-init", "--"]

# Baseline a pre-existing (Sequelize-managed) database if needed, apply pending
# migrations, then start the application. See scripts/baselineExistingDatabase.js.
CMD ["sh", "-c", "node scripts/baselineExistingDatabase.js && npx prisma migrate deploy && node src/index.js"]
