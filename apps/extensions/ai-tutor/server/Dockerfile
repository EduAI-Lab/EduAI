FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache curl dumb-init
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev

FROM node:20-alpine
RUN apk add --no-cache curl dumb-init
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./
COPY prisma ./prisma/
COPY src ./src/

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 4000
ENV PORT=4000
ENV NODE_OPTIONS="--max-old-space-size=384"

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
