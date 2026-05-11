# Dev server deployment (UBC / shared host)

This guide covers deploying and using the **EduAI dev server** on a shared Linux host (`dev.eduai.ok.ubc.ca` / `s378`).

## TL;DR — When and why to use the dev server


| Scenario                                     | Use dev server?                  | Why                                                                                                       |
| -------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| UI / frontend changes only                   | No — local `npm run dev` is fine | No AI calls needed                                                                                        |
| Backend logic that doesn't call AI           | No — local dev works             | DB can run in Docker locally                                                                              |
| **Testing changes that talk to AI (Ollama)** | **Yes**                          | Ollama runs on `cmps01`, which is **not reachable** from personal laptops due to UBC network restrictions |


**Key constraint:** `cmps01.ok.ubc.ca:11434` (Ollama) is only reachable from other UBC servers on the same network (like `s378`). Your laptop cannot reach it directly, even on VPN.

### Workarounds for AI access from a laptop

1. **SSH tunnel** (requires access to `cmps01`, which most devs don't have) :
  ```bash
  ssh -N -L 11435:127.0.0.1:11434 ssaada08@cmps01.ok.ubc.ca
  ```
   Then set `OLLAMA_BASE_URL="http://127.0.0.1:11435"` in your local `.env`. This forwards your local port `11435` to Ollama on `cmps01`.
2. **Use the dev server directly** (recommended for most AI testing) — see below.

## Current access

- **Saad (`ssaada08`)** currently has dev server access.
- Other developers: ask Saad to switch the branch for you, **or** request server access from IT (SSH access to `dev.eduai.ok.ubc.ca`).

## How to use the dev server

### SSH to the server

```bash
ssh YOUR_CWL@dev.eduai.ok.ubc.ca
# password: your UBC CWL password
```

You must be on **UBC VPN** or campus network.

### Switch to your feature branch

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
git fetch origin
git checkout feature/your-branch-name
git pull origin feature/your-branch-name
```

### Start the dev server (use tmux)

The server process **dies when your SSH session ends**. Use `tmux` so it survives disconnects:

```bash
tmux new -s eduai
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
npm run dev
```

Detach from the session (server keeps running): press `Ctrl+B`, then `D`.

Reconnect later (same or new SSH session):

```bash
tmux attach -t eduai
```

Other useful tmux commands:

| Command | What it does |
|---------|--------------|
| `tmux ls` | List active sessions |
| `tmux attach -t eduai` | Reattach to the `eduai` session |
| `tmux kill-session -t eduai` | Kill the session and stop the server |
| `Ctrl+B` then `D` | Detach (server keeps running) |
| `Ctrl+C` (inside tmux) | Stop `npm run dev` |

The app runs on port `5173` internally; Apache proxies `https://dev.eduai.ok.ubc.ca` → `http://127.0.0.1:5173`.

### When you're done

Switch back to `main` so the server is in a known state for others:

```bash
tmux attach -t eduai
# Ctrl+C to stop the running server, then:
git checkout main
git pull origin main
npm run dev
```

Then detach again with `Ctrl+B`, `D`.

---

## Server configuration reference

### `.env` (on the server)

The `.env` lives at `/srv/www/dev.eduai.ok.ubc.ca/EduAICore/.env` and is **not committed to git**. Key values:

```env
NODE_ENV="development"
PORT="5173"
LOG_LEVEL="info"

# Docker Postgres + pgvector (runs on the same host)
DATABASE_URL="postgresql://eduai:eduai_dev_change_me@127.0.0.1:5433/deveduaidb?schema=public"

BETTER_AUTH_SECRET="<generate with: openssl rand -base64 32>"
BETTER_AUTH_URL="https://dev.eduai.ok.ubc.ca"

# Ollama on cmps01 — reachable from s378 over internal network
OLLAMA_BASE_URL="http://cmps01.ok.ubc.ca:11434"

GOOGLE_GENERATIVE_AI_API_KEY=""   # set if using Gemini
FIRECRAWL_API_KEY=""              # set if using Firecrawl web search

ROUTER_AUTO_DEFAULT="true"
```

**Do not** commit real secrets. Passwords with special characters (`$`, `&`, `@`, etc.) must be **URL-encoded** in `DATABASE_URL` — see encoding table below.

### Docker (Postgres + pgvector)

The UBC managed Postgres (`rcpgdb`) is too old for pgvector, so we run our own in Docker:

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
docker compose -f docker-compose.postgres.yml up -d
```

This starts `pgvector/pgvector:pg16` on `127.0.0.1:5433`. The volume `eduai_pgdata` persists data across restarts.

To check status:

```bash
docker compose -f docker-compose.postgres.yml ps
```

To reset the database (destructive):

```bash
docker compose -f docker-compose.postgres.yml down -v
docker compose -f docker-compose.postgres.yml up -d
npx prisma migrate deploy
npm run db:seed
```

### Apache reverse proxy

Config lives at `/etc/httpd/conf.d/dev.eduai.ok.ubc.ca.conf` (edit with `sudo`).

The `*:443` block should have:

```apache
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:5173/
ProxyPassReverse / http://127.0.0.1:5173/
```

After editing:

```bash
sudo httpd -t
sudo systemctl reload httpd
```

### Prisma binary targets

The server runs RHEL 8. `prisma/schema.prisma` must include:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-1.1.x"]
}
```

If you see `Prisma Client could not locate the Query Engine for runtime "rhel-openssl-1.1.x"`, run:

```bash
npx prisma generate
```

---

## Prerequisites (first-time setup only)

- SSH access to the dev host
- Write access to `/srv/www/dev.eduai.ok.ubc.ca` — use `sudo chown -R $USER:$USER` if needed
- Node 20 via Volta (the host's system Node is too new and breaks native addons):
  ```bash
  curl https://get.volta.sh | bash
  source ~/.bashrc
  volta install node@20
  ```
- Docker group membership (`id` should show `docker` group)
- UBC VPN or campus network

## Managed PostgreSQL without pgvector (UBC `rcpgdb`)

Some shared PostgreSQL instances run an older major version and **do not include the `vector` extension** (pgvector). EduAI migrations expect pgvector (`CREATE EXTENSION vector` / `vector(3072)` embeddings). If migrations fail with:

`could not open extension control file ".../vector.control"`

then the server cannot run this app's schema until pgvector exists there. IT may recommend (and this repo supports) running **Postgres+pgvector in Docker** on the dev host for now, and moving to a **dedicated managed Postgres with pgvector** before production.

## Why Docker helps on RHEL-style hosts

Some dependencies ship **native addons** (for example `better-sqlite3`). On older hosts you may see:

- Prebuilt binaries target a **newer glibc** than the server (`GLIBC_2.29` not found)
- Source builds fail because **GCC is too old** (`-std=c++20` not supported)

Building the repo's `Dockerfile` uses **Node 20 on Alpine** inside the image, so `npm ci` runs in a consistent environment independent of host glibc/GCC.

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
docker build -t eduai-dev .
```

## `DATABASE_URL` encoding

Prisma expects a single URI. **URL-encode** special characters in the password:


| Character | Encoded |
| --------- | ------- |
| `$`       | `%24`   |
| `&`       | `%26`   |
| `@`       | `%40`   |
| `:`       | `%3A`   |
| `/`       | `%2F`   |
| `#`       | `%23`   |
| `?`       | `%3F`   |
| space     | `%20`   |


Example shape (dummy values):

```env
DATABASE_URL="postgresql://myuser:MyPa%24%26ss%40word@db.example.org:5432/mydb?schema=public"
```

## Order of operations (full setup)

1. SSH to host, clone repo into `/srv/www/dev.eduai.ok.ubc.ca/EduAICore`
2. Install Node 20 via Volta
3. `npm install` (or `docker build` if host toolchain fails)
4. Start Docker Postgres: `docker compose -f docker-compose.postgres.yml up -d`
5. Create `.env` with correct `DATABASE_URL`, `BETTER_AUTH_URL`, `OLLAMA_BASE_URL`
6. `npx prisma generate && npx prisma migrate deploy && npm run db:seed`
7. Configure Apache vhost with `sudo`, reload `httpd`
8. `npm run dev`

## Related

- [Production restart notes](./production-restart.md) — PM2 + Apache patterns used on some UBCO hosts

Architecture subject to change with monorepo implementation

