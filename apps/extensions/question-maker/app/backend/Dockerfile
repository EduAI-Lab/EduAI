FROM node:24-alpine

# Set working directory
WORKDIR /app

# Install curl for health checks and dumb-init for proper signal handling
RUN apk add --no-cache curl dumb-init

# Copy package files
COPY package*.json ./

# Install dependencies. The `prisma` CLI (a devDependency) is needed at
# runtime for `prisma migrate deploy` below, so dev deps aren't omitted here.
RUN npm ci && npm cache clean --force

# Copy source code and scripts (for seed:production inside container)
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY prisma/ ./prisma/

RUN npx prisma generate

# Copy environment file (if it exists)
COPY .env* ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

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

# Apply pending migrations, then start the application
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
