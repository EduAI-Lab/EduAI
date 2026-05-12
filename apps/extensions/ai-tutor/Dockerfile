FROM node:20-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:20-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

# SPA mode (ssr: false) — serve static assets via nginx
FROM nginx:alpine
RUN apk add --no-cache curl
COPY --from=build-env /app/build/client /usr/share/nginx/html
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
    listen 3001;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
