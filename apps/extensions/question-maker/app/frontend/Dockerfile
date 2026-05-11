# Multi-stage build
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build tools)
RUN npm ci

# Copy source code
COPY . .

# Build the application (skip TypeScript checking for faster builds)
RUN npx vite build

# Production stage
FROM nginx:alpine

# Install curl for health checks (more reliable than wget)
RUN apk add --no-cache curl

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port
EXPOSE 80

# Health check with better timeout and retry logic
# Uses static healthz.html file to avoid nginx processing overhead
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost/healthz.html || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]