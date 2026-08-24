# Build context: monorepo root
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS dependencies

WORKDIR /app

# npm needs every workspace manifest in order to reproduce the root lockfile.
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

RUN npm ci --ignore-scripts

FROM dependencies AS build

COPY packages/types packages/types
COPY packages/ui packages/ui
COPY apps/extensions/question-maker/app/frontend apps/extensions/question-maker/app/frontend

# VITE_* values are public and compiled into the browser bundle. Never pass a
# credential as one of these build arguments.
ARG VITE_API_URL=/api
ARG VITE_CORE_URL=https://eduai.ok.ubc.ca
ARG VITE_AI_TUTOR_URL=https://ai-tutor.eduai.ok.ubc.ca
ARG VITE_QUESTION_MAKER_URL=https://qm.eduai.ok.ubc.ca
ARG VITE_CANVAS_TEST_MODE=false
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_CORE_URL=${VITE_CORE_URL} \
    VITE_AI_TUTOR_URL=${VITE_AI_TUTOR_URL} \
    VITE_QUESTION_MAKER_URL=${VITE_QUESTION_MAKER_URL} \
    VITE_CANVAS_TEST_MODE=${VITE_CANVAS_TEST_MODE}

RUN npm run build -w @eduai/types \
    && npm run build -w question-maker-frontend

# Production stage
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS production

# Install curl for health checks (more reliable than wget)
USER root
RUN apk add --no-cache curl

# Copy built assets from builder stage
COPY --from=build /app/apps/extensions/question-maker/app/frontend/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/extensions/question-maker/app/frontend/nginx.conf /etc/nginx/nginx.conf

# Expose port
EXPOSE 8080

# Health check with better timeout and retry logic
# Uses static healthz.html file to avoid nginx processing overhead
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/healthz.html || exit 1

# Start nginx
USER 101
CMD ["nginx", "-g", "daemon off;"]
