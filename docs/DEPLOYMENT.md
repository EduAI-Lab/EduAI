# Deployment

**Status:** Living document
**Last updated:** 2026-05-18

This document describes how EduAI is deployed. It covers both development and production environments.

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
| **Testing changes that talk to AI (Ollama)** | **Yes**                          | Ollama runs on `cmps01`, which is **not reachable** from personal laptops due to UBC network restrictions |

**Key constraint:** `cmps01.ok.ubc.ca:11434` (Ollama) is only reachable from other UBC servers on the same network (like `s378`). Your laptop cannot reach it directly, even on VPN.

#### Workarounds for AI access from a laptop

1. **SSH tunnel** (requires access to `cmps01`, which most devs don't have):
   ```bash
   ssh -N -L 11435:127.0.0.1:11434 ssaada08@cmps01.ok.ubc.ca
   ```
   Then set `OLLAMA_BASE_URL="http://127.0.0.1:11435"` in your local `apps/core/.env`.
2. **Use the dev server directly** (recommended for most AI testing) — see below.

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

# Ollama on cmps01 — reachable from s378 over internal network
OLLAMA_BASE_URL="http://cmps01.ok.ubc.ca:11434"

GOOGLE_GENERATIVE_AI_API_KEY=""   # set if using Gemini
FIRECRAWL_API_KEY=""              # set if using Firecrawl web search

# Optional: fix Vite HMR over HTTPS reverse proxy
DEV_SERVER_HMR_HOST="dev.eduai.ok.ubc.ca"
DEV_SERVER_HMR_CLIENT_PORT="443"
```

**Do not** commit real secrets. URL-encode special characters in `DATABASE_URL` passwords — see [encoding table](#database_url-encoding) below.

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
