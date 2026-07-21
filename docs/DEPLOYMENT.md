# Deployment

**Status:** Living document
**Last updated:** 2026-05-18

This document describes how EduAI is deployed. It covers both development and production environments.

---

## Table of Contents

1. [Topology](#topology)
2. [Development Deployment](#development-deployment)
3. [Production Deployment](#production-deployment)
4. [Domain Layout](#domain-layout)
5. [Server Topology](#server-topology)
6. [Reverse Proxy](#reverse-proxy)
7. [TLS Certificates](#tls-certificates)
8. [CORS](#cors)
9. [Cookies](#cookies)
10. [OAuth Redirect URIs](#oauth-redirect-uris)
11. [Adding a New Extension](#adding-a-new-extension)

---

## Topology

EduAI uses a shared root domain with per-app subdomains. Each app (Core, AI Tutor, Question Maker, and any future extension) lives on its own subdomain under `eduai.ok.ubc.ca`. Core issues a wildcard session cookie scoped to the root, which all subdomains can read. This keeps auth unified while letting each app deploy independently.

New extensions can be added by registering a subdomain and pointing it at the new app's server — no changes to existing apps or shared infrastructure config required.

---

## Development Deployment

The shared **dev server** (`dev.eduai.ok.ubc.ca` / `s378`) runs the Turborepo monorepo (usually on the `development` branch) for testing changes that need UBC-internal network access (e.g. Ollama on `cmps01`).

### TL;DR — When and why to use the dev server

| Scenario                                     | Use dev server?                  | Why                                                                                                       |
| -------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| UI / frontend changes only                   | No — local `npm run dev` is fine | No AI calls needed                                                                                        |
| Backend logic that doesn't call AI           | No — local dev works             | DB can run in Docker locally                                                                              |
| **Testing changes that talk to AI (Ollama / vLLM on cmps01)** | **Yes** | Inference runs on `cmps01`; **not reachable** from personal laptops (even on VPN) |

**Key constraint:** `cmps01.ok.ubc.ca` is only reachable over the campus network from other UBC servers (e.g. **s378** / `dev.eduai.ok.ubc.ca`). Your laptop must use the dev server or SSH to cmps01 from your machine (if you have cmps01 access).

| Service | Port | Dev (s378) access today |
| ------- | ---- | ------------------------ |
| **Ollama** | **11434** | HTTP allowed (set `OLLAMA_BASE_URL`) |
| **vLLM** | **8001** (`VLLM_PORT`) | HTTP requires IT firewall + cmps01 host firewall (see [vLLM setup](rag-ai/VLLM.md)) |
| **SSH** cmps01 | **22** | **Not** from s378 (timeout) — do not plan dev→cmps01 SSH tunnels |

#### Workarounds for AI access from a laptop

1. **SSH tunnel from your laptop to cmps01** (only if you have cmps01 SSH access):
   ```bash
   ssh -N -L 11435:127.0.0.1:11434 ssaada08@cmps01.ok.ubc.ca
   ```
   Then set `OLLAMA_BASE_URL="http://127.0.0.1:11435"` in local `apps/core/.env`.
2. **Use the dev server directly** (recommended) — `OLLAMA_BASE_URL=http://cmps01.ok.ubc.ca:11434` and, when IT opens **8001**, `VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001` in `apps/core/.env` on s378. See [HOW_TO_USE_DEV_SERVER.md](rag-ai/HOW_TO_USE_DEV_SERVER.md).

### Current access

- **Saad (`ssaada08`)** currently has dev server access.
- Other developers: ask Saad to switch the branch for you, **or** request server access from IT (SSH access to `dev.eduai.ok.ubc.ca`).

### Monorepo layout on the server

The repo is a **Turborepo** monorepo. Install and run commands from the **repository root**, not only `apps/core`.

| What           | Where                                              |
| -------------- | -------------------------------------------------- |
| Clone path     | `/srv/www/dev.eduai.ok.ubc.ca/EduAICore`           |
| App env        | `apps/core/.env` (not committed)                   |
| Docker DBs     | `docker-compose.dev.yml` at repo root              |
| EduAI dev port | **3000** (Apache proxies HTTPS → `127.0.0.1:3000`) |

On the shared host we usually run **EduAI only**:

```bash
npx turbo run dev --filter=edu-ai
```

`npm run dev` at the root starts **all** apps (Core + AI Tutor + Question Maker) and all three databases via the `predev` hook.

### How to use the dev server

#### SSH to the server

```bash
ssh YOUR_CWL@dev.eduai.ok.ubc.ca
```

You must be on **UBC VPN** or campus network.

#### Deploy / update code

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
git fetch origin
git checkout development          # or your feature branch merged with development
git pull origin development
```

After switching branches:

```bash
npm install                       # always from repo root
npm run docker:dev:db:eduai       # EduAI Postgres only
cd apps/core
npx prisma generate
npx prisma migrate deploy
```

#### Start the dev server (use tmux)

The server process **dies when your SSH session ends**. Use `tmux` so it survives disconnects:

```bash
tmux new -s eduai
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
npm run docker:dev:db:eduai
npx turbo run dev --filter=edu-ai
```

Detach: `Ctrl+B`, then `D`. Reattach: `tmux attach -t eduai`.

| Command                      | What it does                         |
| ---------------------------- | ------------------------------------ |
| `tmux ls`                    | List active sessions                 |
| `tmux attach -t eduai`       | Reattach to the `eduai` session      |
| `tmux kill-session -t eduai` | Kill the session and stop the server |
| `Ctrl+B` then `D`            | Detach (server keeps running)        |
| `Ctrl+C` (inside tmux)       | Stop the dev process                 |

Apache proxies `https://dev.eduai.ok.ubc.ca` → `http://127.0.0.1:3000`.

#### When you're done

Switch back to `development` (or `main`) so the server is in a known state for others:

```bash
tmux attach -t eduai
# Ctrl+C to stop, then:
git checkout development
git pull origin development
npm install
npm run docker:dev:db:eduai
npx turbo run dev --filter=edu-ai
```

Detach again with `Ctrl+B`, `D`.

### Server configuration reference

#### `apps/core/.env` (on the server)

Copy from `apps/core/.env.example` if missing (`npm install` runs `postinstall` which creates it on a fresh clone). Key values for the shared host:

```env
NODE_ENV="development"

# Docker EduAI DB (docker-compose.dev.yml, default port 54320)
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54320/eduai?schema=public"

BETTER_AUTH_SECRET="<generate with: openssl rand -base64 32>"
BETTER_AUTH_URL="https://dev.eduai.ok.ubc.ca"

# cmps01 GPU inference (HTTP from s378 — not from laptop)
OLLAMA_BASE_URL="http://cmps01.ok.ubc.ca:11434"

# vLLM — after IT opens TCP 8001 (+ host firewall on cmps01)
# VLLM_PORT=8001
# VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
# VLLM_API_KEY="vllm-local"
# Multi-server fleet — round-robin vllm:* chat across healthy hosts (see docs/DEPLOYMENT.md)
# VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001"
# VLLM_FLEET_HEAVY_URL="http://cmps03.ok.ubc.ca:8001"
# VLLM_FLEET_DEFAULT_MODELS="qwen2.5-7b-instruct,qwen2.5-32b-instruct"

GOOGLE_GENERATIVE_AI_API_KEY=""   # set if using Gemini
FIRECRAWL_API_KEY=""              # set if using Firecrawl web search

# Optional: fix Vite HMR over HTTPS reverse proxy
DEV_SERVER_HMR_HOST="dev.eduai.ok.ubc.ca"
DEV_SERVER_HMR_CLIENT_PORT="443"
```

**Do not** commit real secrets. URL-encode special characters in `DATABASE_URL` passwords — see [encoding table](#database_url-encoding) below.

#### vLLM fleet routing (optional)

When `VLLM_FLEET_CHAT_URLS` is set, Core load-balances **`vllm:*`** chat requests across healthy GPU hosts (round-robin with a 30s health cache). Unhealthy hosts are skipped; if no host qualifies, `/api/chat` returns **503**. On inference failure to a picked host, Core **invalidates** that host’s health cache and **retries once** on another healthy host in the same pool (`fleetRetry: true` in logs; `X-Fleet-Server` is the final host). Fleet applies only to vLLM models — Ollama and cloud providers are unchanged.

| Variable | Purpose |
| -------- | ------- |
| `VLLM_FLEET_CHAT_URLS` | Comma-separated chat/interactive pool (e.g. cmps01 + cmps02 `:8001`) |
| `VLLM_FLEET_HEAVY_URL` | Optional background pool for Question Maker (`routingContext.jobType: background`); falls back to chat pool when unset |
| `VLLM_FLEET_DEFAULT_MODELS` | Expected model ids for health checks and smoke script (default: `qwen2.5-7b-instruct,qwen2.5-32b-instruct`) |
| `VLLM_BASE_URL` | Fallback single-host URL when fleet env is empty; still required as a baseline on dev |
| `AI_MAX_INFLIGHT` | Max concurrent local-GPU chat slots in this Core process (default `8`; `0` = off) |
| `AI_ADMISSION_WAIT_MS` | Max wait for an admission slot before **503** `AI_ADMISSION_TIMEOUT` (default `15000`) |
| `FLEET_STREAM_PROBE_MS` | Soft-timeout waiting for first stream chunk/step before treating the host as ready for Slice 2 retry (default `10000`) |

Pre-flight from **`apps/core`** on a host that can reach cmps (e.g. s378):

```bash
npm run fleet:smoke
npx vitest run app/tests/unit/fleet-routing.test.ts app/tests/unit/admission.server.test.ts
```

Successful picks expose `X-Fleet-Server: cmps01` (or `cmps02`) on `/api/chat` responses. Queued requests may include `X-Admission-Wait-Ms`. See [`MULTI_SERVER_ROUTING_PLAN.md`](rag-ai/routing/eduai-summer-2026/MULTI_SERVER_ROUTING_PLAN.md) for architecture details.

**Note:** cmps02 may be unreachable from s378 until campus firewall rules are applied (IT ticket INC5196289). Fleet degrades gracefully — only healthy hosts participate in round-robin.

#### Docker (Postgres + pgvector)

UBC managed Postgres (`rcpgdb`) is too old for pgvector. Use Compose at the repo root:

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore

# EduAI DB only (typical for this host)
npm run docker:dev:db:eduai

# Or all three dev databases
npm run docker:dev:db
```

| Database         | Container                 | Default host port | DB name          | User / password         |
| ---------------- | ------------------------- | ----------------- | ---------------- | ----------------------- |
| EduAI (pgvector) | `eduai-db`                | `54320`           | `eduai`          | `postgres` / `postgres` |
| AI Tutor         | `eduai-ai-tutor-db`       | `54321`           | `ai-tutor`       | `postgres` / `postgres` |
| Question Maker   | `eduai-question-maker-db` | `55432`           | `question-maker` | `postgres` / `password` |

Override ports via root `.env` (copy from `.env.example`: `CORE_DB_PORT`, etc.).

Check status:

```bash
docker compose -f docker-compose.dev.yml ps
```

Reset EduAI database (destructive):

```bash
docker compose -f docker-compose.dev.yml down
docker volume rm eduai_db_data   # confirm name with: docker volume ls | grep eduai
npm run docker:dev:db:eduai
cd apps/core && npx prisma migrate deploy && npm run db:seed
```

#### Apache reverse proxy

Apache terminates HTTPS and forwards traffic to the Vite dev server on the host. The vhost file is:

`/etc/httpd/conf.d/dev.eduai.ok.ubc.ca.conf`

That path is a **configuration file**, not a command. Do **not** run `sudo /etc/httpd/conf.d/dev.eduai.ok.ubc.ca.conf` — that will fail with `command not found`.

##### View the current config

```bash
sudo cat /etc/httpd/conf.d/dev.eduai.ok.ubc.ca.conf
```

Look for `ProxyPass` / `ProxyPassReverse` inside the `<VirtualHost *:443>` block (or equivalent SSL vhost).

##### Edit the config

Use an editor with `sudo` (you need root to write under `/etc/httpd/`):

```bash
sudo nano /etc/httpd/conf.d/dev.eduai.ok.ubc.ca.conf
```

(`sudo vi /etc/httpd/conf.d/dev.eduai.ok.ubc.ca.conf` works too.)

In the HTTPS vhost block, set the upstream to **port 3000** (EduAI on the Turborepo `development` branch). If you still see **5173**, that is the old port — change both lines:

```apache
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:3000/
ProxyPassReverse / http://127.0.0.1:3000/
```

Save and exit (`nano`: `Ctrl+O`, Enter, `Ctrl+X`).

Apache must allow WebSocket upgrades for Vite HMR if you use hot reload through the proxy. If HMR still fails after fixing the port, ask IT or check whether `mod_proxy_wstunnel` is enabled and that nothing else in the vhost blocks `Upgrade` headers.

##### Validate and apply

Always test syntax before reload:

```bash
sudo httpd -t
```

If you see `Syntax OK`, reload Apache (no full restart needed for proxy changes):

```bash
sudo systemctl reload httpd
```

Confirm the dev app is listening before testing in a browser:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/
```

You should get a response (often `200`) while `npx turbo run dev --filter=edu-ai` is running in tmux.

#### Prisma on RHEL 8

`apps/core/prisma/schema.prisma` includes `binaryTargets = ["native", "rhel-openssl-1.1.x"]` for the dev host.

If you see `Prisma Client could not locate the Query Engine for runtime "rhel-openssl-1.1.x"`:

```bash
cd apps/core && npx prisma generate
```

### Prerequisites (first-time setup only)

- SSH access to the dev host
- Write access to `/srv/www/dev.eduai.ok.ubc.ca`
- **Node 20** via [Volta](https://volta.sh) (system Node on RHEL 8 is often too new or breaks native addons):
  ```bash
  curl https://get.volta.sh | bash
  source ~/.bashrc
  volta install node@20
  ```
- Docker group membership (`id` should show `docker` group)
- UBC VPN or campus network

### `npm install` on RHEL 8

Install **from the monorepo root**, not `apps/core` alone.

Some packages pull in native addons (e.g. `better-sqlite3` via `@better-auth/cli`). On RHEL 8 you may see:

- `GLIBC_2.29` not found (prebuilt binary mismatch)
- `g++: unrecognized command line option '-std=c++20'` (GCC too old)

**Workaround** (Postgres-only EduAI dev — SQLite adapter not needed at runtime):

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
npm install --ignore-scripts
cd apps/core && npx prisma generate
```

`--omit=optional` is **not** enough; `@better-auth/cli` depends on `better-sqlite3` as a regular dependency.

### `DATABASE_URL` encoding

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

Example:

```env
DATABASE_URL="postgresql://myuser:MyPa%24%26ss%40word@127.0.0.1:54320/eduai?schema=public"
```

### Order of operations (full setup)

1. SSH to host; clone into `/srv/www/dev.eduai.ok.ubc.ca/EduAICore`
2. `git checkout development && git pull`
3. Install Node 20 via Volta
4. `npm install` at repo root (use `--ignore-scripts` if native build fails)
5. `npm run docker:dev:db:eduai`
6. Configure `apps/core/.env` (`DATABASE_URL`, `BETTER_AUTH_URL`, `OLLAMA_BASE_URL`, optional HMR vars)
7. `cd apps/core && npx prisma generate && npx prisma migrate deploy && npm run db:seed`
8. Configure Apache vhost → **port 3000**; `sudo systemctl reload httpd`
9. `tmux new -s eduai` → `npx turbo run dev --filter=edu-ai`

### Branch switching checklist

Avoid mixing old and new layouts when hopping branches:

1. Stop dev server (`Ctrl+C` in tmux)
2. `git fetch && git checkout <branch> && git pull`
3. `npm install` (root)
4. `npm run docker:dev:db:eduai`
5. `cd apps/core && npx prisma migrate deploy`
6. Confirm `apps/core/.env` still matches this doc (port **54320**, auth URL **https://dev.eduai.ok.ubc.ca**)
7. Restart `npx turbo run dev --filter=edu-ai`

See also the [root README](../README.md) for local Turborepo workflow, all app ports, and database commands.

---

## Production Deployment

### Domain Layout

All apps live under `eduai.ok.ubc.ca`. Each app gets its own subdomain:

| App             | Subdomain                     |
| --------------- | ----------------------------- |
| Core            | `eduai.ok.ubc.ca`             |
| AI Tutor        | `ai-tutor.eduai.ok.ubc.ca`    |
| Question Maker  | `qm.eduai.ok.ubc.ca`          |
| Future apps     | `<name>.eduai.ok.ubc.ca`      |

Core issues a session cookie with `Domain=.eduai.ok.ubc.ca`, so all subdomains receive it automatically on requests.

### Server Topology

Each app runs as an independent service. The topology is flexible — apps can be co-located on one server or split across separate servers without changing app code. A reasonable starting point:

- **Single host** running all three apps as separate processes (e.g. systemd services or containers), each bound to a distinct internal port.
- Each app can later move to its own host by updating the relevant subdomain's DNS record. No app-level changes required.

### Reverse Proxy

Each app sits behind a reverse proxy (nginx or Caddy) that:

- Terminates TLS for its subdomain
- Forwards traffic to the app's internal port
- Handles HTTP → HTTPS redirects

The proxy is scoped per-app, not shared across all apps. A misconfiguration or restart on one app's proxy does not affect others. If apps are co-located on one host, a single proxy process can serve multiple subdomains via separate server blocks — this is acceptable as long as the blocks are independent and one app's config changes don't risk breaking another's routing.

### Client IP & X-Forwarded-For (security invariant)

Core records the client IP (`ipAddress`) on audit/security log rows and uses it for the `/admin/logs`
IP-triage filter and session rate limiting. That IP is derived from the **last** `x-forwarded-for`
(XFF) entry in `apps/core/app/lib/request-context.server.ts`. For that to be trustworthy, the live
topology must hold this invariant:

- **Exactly one trusted reverse proxy** in front of each app — on the shared host that is Apache
  (`ProxyPass / http://127.0.0.1:3000/`, `ProxyPreserveHost On`) terminating HTTPS and forwarding to
  Node on `localhost`. No Cloudflare and no second proxy sit in front.
- **Node must not be directly reachable.** It binds to `127.0.0.1` only; the internal app port is not
  exposed to the network. If a client could reach Node directly, it could send an arbitrary XFF and
  fully control the recorded IP.
- The vhosts do **not** set `RemoteIP*` or rewrite `X-Forwarded-*` — we rely on Apache mod_proxy's
  default behavior, which **appends** the real socket-peer address as the last XFF entry. A spoofed
  `X-Forwarded-For: 1.2.3.4` therefore arrives as `1.2.3.4, <real-client>` and Core records the
  real client (rightmost token). Process management (tmux → systemd user units) does not change this.
- `x-real-ip` / `cf-connecting-ip` are intentionally **not** honored, because Apache does not set them.

**If a second proxy is ever added** (e.g. Cloudflare in front of Apache), the rightmost XFF entry
becomes that proxy's address rather than the client's. The IP selection in `request-context.server.ts`
and its tests (`request-context.test.ts`, `sessions-validate.integration.test.ts`) must be updated as
part of that deployment change. See [LOGGING.md §3](./LOGGING.md).

### TLS Certificates

Two viable options:

- **Wildcard cert** for `*.eduai.ok.ubc.ca` — one cert covers all current and future subdomains. Requires DNS-01 challenge for renewal.
- **Per-subdomain certs** via Let's Encrypt HTTP-01 — simpler to set up, auto-renewed by Caddy or certbot. New subdomains need a one-time issuance step at provisioning.

Per-subdomain certs are the simpler default; wildcard becomes attractive once the number of extensions grows.

### CORS

Cross-subdomain browser requests require explicit CORS headers from Core's API, since each subdomain is a distinct origin. Configure Core to allow credentialed requests from the known extension origins:

```
Access-Control-Allow-Origin: https://ai-tutor.eduai.ok.ubc.ca
Access-Control-Allow-Credentials: true
```

The allow-list is maintained in Core's config and updated when new extensions are added.

### Cookies

Core issues session cookies with:

```
Domain=.eduai.ok.ubc.ca
Secure
HttpOnly
SameSite=Lax
```

`SameSite=Lax` is sufficient for top-level navigation between subdomains. If any cross-subdomain background fetches need to send cookies, `SameSite=None; Secure` will be required instead — revisit if/when that pattern shows up.

### OAuth Redirect URIs

Core's OIDC client registrations must list the exact production redirect URI for each extension (e.g. `https://ai-tutor.eduai.ok.ubc.ca/auth/callback`). These are registered once per extension at provisioning time and must not change without coordinated updates on both sides.

### Adding a New Extension

1. Register the subdomain DNS A/AAAA record pointing at the target host
2. Issue a TLS cert for the subdomain
3. Add a reverse proxy server block for the subdomain
4. Add the extension's origin to Core's CORS allow-list
5. Register the extension's redirect URI in Core's OIDC client config
6. Deploy the app

No changes to existing apps required.
