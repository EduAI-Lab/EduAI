# Build context: monorepo root
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS workspace

WORKDIR /app

# npm resolves the committed lockfile against the complete workspace graph.
COPY package.json package-lock.json .npmrc ./
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/core/package.json apps/core/package.json
COPY apps/extensions/example-extension/package.json apps/extensions/example-extension/package.json
COPY apps/extensions/ai-tutor/package.json apps/extensions/ai-tutor/package.json
COPY apps/extensions/ai-tutor/server/package.json apps/extensions/ai-tutor/server/package.json
COPY apps/extensions/question-maker/package.json apps/extensions/question-maker/package.json
COPY apps/extensions/question-maker/app/backend/package.json apps/extensions/question-maker/app/backend/package.json
COPY apps/extensions/question-maker/app/frontend/package.json apps/extensions/question-maker/app/frontend/package.json

FROM workspace AS build

RUN npm ci --ignore-scripts

COPY packages/types packages/types
COPY packages/ui packages/ui
COPY scripts/prisma-generate.mjs scripts/prisma-generate.mjs
COPY apps/core apps/core

RUN npm run build -w @eduai/types \
    && npm run build -w edu-ai

FROM workspace AS production-deps

COPY packages/types packages/types
COPY packages/ui packages/ui
COPY apps/core/prisma apps/core/prisma

# Prisma is a runtime dependency because the container applies committed
# migrations before accepting traffic. Generate for Alpine in this stage so
# the final image never reuses a host-platform query engine.
RUN npm ci --ignore-scripts --omit=dev \
      --workspace=edu-ai \
      --workspace=@eduai/types \
      --workspace=@eduai/ui \
      --include-workspace-root=false

# Keep engine download/generation separate so a transient Prisma CDN failure
# does not invalidate the reproducible dependency-install layer.
RUN ./node_modules/.bin/prisma generate \
      --schema=apps/core/prisma/schema.prisma

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS production

WORKDIR /app

RUN apk add --no-cache curl dumb-init openssl \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 -G nodejs

COPY --from=production-deps /app/node_modules node_modules
COPY --from=production-deps /app/packages/types packages/types
COPY --from=production-deps /app/packages/ui packages/ui
COPY --from=production-deps /app/apps/core/node_modules apps/core/node_modules
COPY apps/core/package.json apps/core/package.json
COPY apps/core/prisma apps/core/prisma
COPY --from=build /app/apps/core/build apps/core/build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PATH="/app/apps/core/node_modules/.bin:/app/node_modules/.bin:${PATH}"

USER nodejs
WORKDIR /app/apps/core

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "prisma migrate deploy && exec react-router-serve ./build/server/index.js"]
