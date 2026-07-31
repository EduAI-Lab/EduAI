### How to use the shared s378 / `dev.eduai` server

## Prerequisites
- UBC VPN (or campus network)
- SSH: `ssh YOUR_CWL@s378.ok.ubc.ca` (same host as `dev.eduai.ok.ubc.ca`)
- RAG embeddings: set **`EMBEDDING_PROVIDER=local`**, **`OLLAMA_EMBEDDING_MODEL=mxbai-embed-large`**, and **`OLLAMA_BASE_URL`** in `apps/core/.env` (Ollama runs on cmps01). Pull the model once: `ollama pull mxbai-embed-large`. For laptop dev without Ollama, use **`EMBEDDING_PROVIDER=cloud`** plus **`OPENROUTER_API_KEY`** or **`OPENAI_API_KEY`** (local mode does not silently fall back to cloud). Verify with `npm run test:embedding` from `apps/core`. After the LOCAL-EMBEDDINGS migration, re-embed courses with `npm run re-embed:course -- <courseId>`. See [`EMBEDDINGS.md`](./EMBEDDINGS.md) and [`LOCAL-EMBEDDINGS.md`](./LOCAL-EMBEDDINGS.md).

## Public URLs

| App | URL | Proxies to |
|-----|-----|------------|
| Core | https://dev.eduai.ok.ubc.ca | `:3000` |
| AI Tutor | https://dev.aitutor.eduai.ok.ubc.ca | FE `:3001`, `/api/` → `:4000` |
| Question Maker | https://dev.questionmaker.eduai.ok.ubc.ca | FE `:5173`, `/api/` → `:8000` |

Shared session cookies use **`COOKIE_DOMAIN=.eduai.ok.ubc.ca`** so login on Core works across extension hosts. After that env is enabled (or changed), **sign in again** (extensions send `?force=1` on login to avoid a redirect loop).

Ops details for extensions + env sync: [`infra/s378/GO-LIVE.md`](../../infra/s378/GO-LIVE.md).

## Process management (systemd — preferred)

The shared stack is meant to run under **systemd user units** (not long-lived tmux). Units live in `infra/s378/systemd/` and are installed for the app user (e.g. `ssaada08`).

| Unit | Port |
|------|------|
| `eduai-core.service` | `:3000` |
| `eduai-aitutor-server.service` | `:4000` |
| `eduai-aitutor-fe.service` | `:3001` |
| `eduai-qm-backend.service` | `:8000` |
| `eduai-qm-frontend.service` | `:5173` |
| `eduai-dev.target` | all of the above |

### One-time setup

```bash
# From the repo on s378 (or ~/dev-vhosts with systemd/ copied)
bash infra/s378/go-live-systemd-install.sh

# Required so units survive SSH logout / reboot:
sudo loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger   # expect Linger=yes

# Stop any old tmux sessions and start the stack:
bash infra/s378/go-live-systemd-start.sh
```

### Day-to-day

```bash
systemctl --user status eduai-dev.target
systemctl --user restart eduai-dev.target          # all five
systemctl --user restart eduai-core                # Core only
systemctl --user restart eduai-aitutor-fe          # AI Tutor FE only
journalctl --user -u eduai-core -f                 # logs (if permitted)

# After apps/core/.env or extension .env changes:
bash ~/dev-vhosts/go-live-env.sh                   # sync public URLs + EDUAI_API_KEY
systemctl --user restart eduai-dev.target
```

**503 Service Unavailable** from Apache usually means the Node process on that port is down or still starting. Check:

```bash
systemctl --user is-active eduai-core eduai-aitutor-fe eduai-qm-frontend
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
systemctl --user restart --no-block eduai-core
```

## Switch the shared server to your feature branch

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
git fetch origin
git checkout [your-feature-branch]
git pull origin [your-feature-branch]
npm install   # if dependencies changed
cd apps/core && npx prisma generate && npx prisma migrate deploy
systemctl --user restart eduai-dev.target
```

**Changing embedding dimension on the shared server:** if your branch uses a different `vector(N)` than the DB currently has, follow [How to change vector dimensionality](./EMBEDDINGS.md#how-to-change-vector-dimensionality) before re-embedding.

After switching branches, hard-refresh the browser. Vite HMR often picks up changes; if not, restart the relevant unit(s).

## Legacy: tmux (fallback only)

Prefer systemd. If you must use tmux for a quick one-off Core process:

```bash
tmux new -s eduai
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
npm run docker:dev:db:eduai
npx turbo run dev --filter=edu-ai
```

Detach: `Ctrl+B`, then `D`. Reattach: `tmux attach -t eduai`.

| Command | What it does |
| ------- | ------------ |
| `tmux ls` | List sessions |
| `tmux attach -t eduai` | Reattach |
| `tmux kill-session -t eduai` | Stop that session |
| `Ctrl+B` then `D` | Detach |

Do **not** leave a tmux Core and a systemd `eduai-core` fighting for port `3000`. Stop one stack before starting the other (`bash ~/dev-vhosts/go-live-systemd-start.sh` kills the known tmux session names first).

## cmps01 inference (Ollama + vLLM)

Local **chat** models run on **cmps01**; the app calls them over **HTTP** (not SSH). See [ARCHITECTURE.md](../ARCHITECTURE.md#cmps01-gpu-inference-host).

Add to `apps/core/.env` on **s378**:

```env
# Ollama — works today from dev
OLLAMA_BASE_URL="http://cmps01.ok.ubc.ca:11434"

# vLLM — LiteLLM proxy on cmps01 (TCP 8001 open dev → cmps01)
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="<same generated secret as the fleet hosts>"
```

Restart after editing `.env`: `systemctl --user restart eduai-core`.

| Check | Command (on s378) |
| ----- | ----------------- |
| Ollama reachable | `curl -s http://cmps01.ok.ubc.ca:11434/api/tags \| head` |
| vLLM models | `curl -s http://cmps01.ok.ubc.ca:8001/v1/models -H "Authorization: Bearer ${VLLM_API_KEY}" \| jq '.data[].id'` |
| vLLM chat smoke | `cd apps/core && npm run vllm:smoke` |
| SSH s378 → cmps01 | **Fails** (port 22 timeout) — **do not** use an SSH tunnel from s378 |

**vLLM ops on cmps01:** [`VLLM.md`](./VLLM.md) · [`infra/cmps01/README.md`](../../infra/cmps01/README.md)

In the app: pick **`vllm:qwen3.5-2b`** or **`vllm:qwen3.5-27b`** in chat. Register models in **Admin → AI Models** (vLLM provider → **Refresh list**) or run the provider sync.

## Auth / login troubleshooting

Required in `apps/core/.env` on the server:

```env
BETTER_AUTH_URL="https://dev.eduai.ok.ubc.ca"
BETTER_AUTH_SECRET="<openssl rand -base64 32>"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54320/eduai?schema=public"
COOKIE_DOMAIN=".eduai.ok.ubc.ca"
```

`COOKIE_DOMAIN=.eduai.ok.ubc.ca` is **required** on this shared host so Core, AI Tutor, and Question Maker share the session. After enabling it, users must sign in again (see extension redirects with `?force=1`).

After a DB reset, **register a new account** — old passwords are gone. Demo accounts (when seeded) appear on the login page.

**Silent login (page reloads, no error):** usually session cookies not stored. Check:

1. Restart Core after `.env` changes: `systemctl --user restart eduai-core`.
2. Browser DevTools → Network → POST `/auth/login` → Response headers: expect **multiple** `Set-Cookie` with `Secure` and `Domain=.eduai.ok.ubc.ca`.
3. From SSH, smoke-test the auth API:

```bash
curl -si -X POST "https://dev.eduai.ok.ubc.ca/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}' | head -40
```

`401` = wrong credentials. `200` with `Set-Cookie` but browser still fails → cookie `Secure` / `Domain` mismatch (ensure `BETTER_AUTH_URL` is `https://…`, not `localhost`).

**Can’t log in again after logout:** use **Log out** in the UI (server `POST /auth/logout`), not only client-side sign-out. Clear site cookies for `*.eduai.ok.ubc.ca` once if a stale `__Secure-better-auth.session_token` remains. Verify sign-out clears cookies:

```bash
curl -si -X POST "https://dev.eduai.ok.ubc.ca/api/auth/sign-out" \
  -H "Cookie: __Secure-better-auth.session_token=YOUR_TOKEN" | head -20
```

**Extension infinite “Loading…”:** usually a host-only Core cookie (issued before `COOKIE_DOMAIN` was set). Open the extension → Core login with `force=1` → sign in again.

**Shared `EDUAI_API_KEY`:** Core and extension backends must match (topic sync / reconcile). Sync with `bash ~/dev-vhosts/go-live-env.sh`. Interactive QM AI chat prefers the session cookie; see [`infra/s378/GO-LIVE.md`](../../infra/s378/GO-LIVE.md).

## When you're done

Switch the shared tree back to `development` (or the agreed default) so others have a known state:

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
git checkout development
git pull origin development
npm install
cd apps/core && npx prisma generate && npx prisma migrate deploy
systemctl --user restart eduai-dev.target
```

If your branch changed embedding dimension, revert the shared DB and `.env` for the branch you return to — see [How to change vector dimensionality](./EMBEDDINGS.md#how-to-change-vector-dimensionality) (section **Switching back**).
