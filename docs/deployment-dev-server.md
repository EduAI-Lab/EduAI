# Dev server deployment (UBC / shared host)

This guide covers deploying EduAI Core on a shared Linux host (for example `dev.eduai.ok.ubc.ca`) when **native `npm install` on the host fails** (old glibc, GCC, etc.) and when the app is served behind **Apache** with a **managed PostgreSQL** instance.

## Prerequisites

- SSH access to the dev host
- Write access to the site tree (for example `/srv/www/dev.eduai.ok.ubc.ca`) — IT may need to `chown`/`chgrp` or set ACLs
- PostgreSQL credentials (host, port, database, user, password) from IT — **or** a local Postgres+pgvector container (see below)
- Optional: **Docker** on the host (`docker` group membership) to build/run without fighting host compilers

## Managed PostgreSQL without pgvector (UBC `rcpgdb`)

Some shared PostgreSQL instances run an older major version and **do not include the `vector` extension** (pgvector). EduAI migrations expect pgvector (`CREATE EXTENSION vector` / `vector(3072)` embeddings). If migrations fail with:

`could not open extension control file ".../vector.control"`

then the server cannot run this app’s schema until pgvector exists there. IT may recommend (and this repo supports) running **Postgres+pgvector in Docker** on the dev host for now, and moving to a **dedicated managed Postgres with pgvector** before production.

### Docker Postgres + pgvector (dev)

From the repo root on the machine that runs the app (your laptop or `dev.eduai` host):

```bash
docker compose -f docker-compose.postgres.yml up -d
```

Point `.env` at the container (port **5433** is published only on `127.0.0.1` by default):

```env
DATABASE_URL="postgresql://eduai:eduai_dev_change_me@127.0.0.1:5433/deveduaidb?schema=public"
```

Change `POSTGRES_PASSWORD` in `docker-compose.postgres.yml` and the same value in `DATABASE_URL` for anything beyond local throwaway dev. Then:

```bash
npx prisma migrate deploy
npm run db:seed
```

**Shared server note:** Only users on that host can reach `127.0.0.1:5433`. The app process must run on the same machine (or use a private Docker network you control), not from another host pointing at this port without extra networking.
- UBC VPN or campus network if required for DB or SSH

## Why Docker helps on RHEL-style hosts

Some dependencies ship **native addons** (for example `better-sqlite3`). On older hosts you may see:

- Prebuilt binaries target a **newer glibc** than the server (`GLIBC_2.29` not found)
- Source builds fail because **GCC is too old** (`-std=c++20` not supported)

Building the repo’s `Dockerfile` uses **Node 20 on Alpine** inside the image, so `npm ci` runs in a consistent environment independent of host glibc/GCC.

```bash
cd /path/to/EduAICore   # or EduAICoreLearning, whichever repo you deploy

docker build -t eduai-dev .
```

Run (example — map port and inject env):

```bash
docker run --rm -p 5173:5173 --env-file .env eduai-dev
```

Adjust port and image `CMD` to match how you run the app in production (often `npm run start` after a build stage). **Apache** should `ProxyPass` to whatever port the container publishes on the loopback interface.

## `DATABASE_URL` (PostgreSQL)

Prisma and most clients expect a **single URI**. Rules that avoid subtle bugs:

1. **URL-encode** the password (and username if needed). Characters that must be encoded in the password include:

   - `$` → `%24`
   - `&` → `%26`
   - `@` → `%40`
   - `:` → `%3A`
   - `/` → `%2F`
   - `#` → `%23`
   - `?` → `%3F`
   - space → `%20`

   **`&` in a password is especially important:** in a URI it is treated as starting another key/value, so the connection string can be parsed incorrectly if you skip encoding.

2. Include Prisma’s schema query parameter:

   ```text
   postgresql://USER:ENCODED_PASSWORD@HOST:5432/DATABASE?schema=public
   ```

3. **Do not** paste real passwords into docs or tickets. Store credentials in `.env` or a secrets manager; rotate if exposed.

### Example shape (dummy values)

```env
DATABASE_URL="postgresql://myuser:MyPa%24%26ss%40word@db.example.org:5432/mydb?schema=public"
```

### Verifying connectivity

From the **same machine** that will run the app or Prisma:

```bash
# DNS
getent hosts rcmydb.ok.ubc.ca

# TCP reachability (if nc is available)
nc -zv rcmydb.ok.ubc.ca 5432

# If psql exists and URL is correct
psql "postgresql://USER:PASSWORD@rcmydb.ok.ubc.ca:5432/deveduaidb?schema=public" -c 'select 1'
```

**`Error: P1001: Can't reach database server`** usually means the client never opened a TCP connection (firewall, wrong host/port, DB down, or host not on the allowlist). Fix with IT if the host running Docker/Node is not allowed to connect to `rcmydb.ok.ubc.ca:5432`.

Authentication or SSL issues typically produce a different Prisma error after the connection is established; still fix URL encoding first so the URI is parsed correctly.

## Apache

IT typically points `dev.eduai.ok.ubc.ca` at your app via `/etc/httpd/conf.d/dev.eduai.ok.ubc.ca.conf` (or similar). You choose an **internal HTTP port** (for example `5173` or `3000`) where Node listens; Apache `ProxyPass` / `ProxyPassReverse` to `http://127.0.0.1:PORT/`.

Set **`BETTER_AUTH_URL`** to the **public** origin users use in the browser (for example `https://dev.eduai.ok.ubc.ca`), not only `http://localhost:5173`, otherwise cookies and redirects can break behind TLS and a reverse proxy.

## Order of operations

1. Obtain DB credentials; build a correct **`DATABASE_URL`** with encoding and `?schema=public`
2. Confirm TCP access from the server (`nc` / `psql`)
3. Place `.env` in the app root (never commit it)
4. Install deps (Docker build or host `npm ci`)
5. Run migrations: `npx prisma migrate deploy` (production-like) or `npm run db:migrate` (dev)
6. Seed if needed: `npm run db:seed`
7. Start the app; configure Apache to the app port; reload `httpd`

## Related

- [Production restart notes](./production-restart.md) — PM2 + Apache patterns used on some UBCO hosts
