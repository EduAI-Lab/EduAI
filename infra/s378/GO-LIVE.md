# s378 extension hosting (dev)

Public hosts (Apache → local Vite/Node):

| Host | Proxies to |
|------|------------|
| `https://dev.eduai.ok.ubc.ca` | Core `:3000` |
| `https://dev.aitutor.eduai.ok.ubc.ca` | AI Tutor FE `:3001`, `/api/` → `:4000` |
| `https://dev.questionmaker.eduai.ok.ubc.ca` | QM FE `:5173`, `/api/` → `:8000` |

## Process management (prefer systemd over tmux)

tmux is fine for a quick smoke test; it is **not** reliable long-term (logout, reboot, crash, partial restarts). Use **systemd user units** instead:

| Unit | Port |
|------|------|
| `eduai-core.service` | `:3000` |
| `eduai-aitutor-server.service` | `:4000` |
| `eduai-aitutor-fe.service` | `:3001` |
| `eduai-qm-backend.service` | `:8000` |
| `eduai-qm-frontend.service` | `:5173` |
| `eduai-dev.target` | starts/stops all of the above |

### One-time install on s378

```bash
# From repo (or copy infra/s378 → ~/dev-vhosts including systemd/)
bash infra/s378/go-live-systemd-install.sh

# Required once so units survive SSH logout / reboot:
sudo loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger   # Linger=yes

# Stop tmux sessions and start the systemd stack:
bash infra/s378/go-live-systemd-start.sh
```

### Day-to-day

```bash
systemctl --user status eduai-dev.target
systemctl --user restart eduai-dev.target          # all five
systemctl --user restart eduai-aitutor-fe          # one app
journalctl --user -u eduai-core -f                 # logs
```

After env/code changes: `bash ~/dev-vhosts/go-live-env.sh` then `systemctl --user restart eduai-dev.target`.

The older `go-live-reset.sh` (tmux) remains as a fallback only.

## Scripts (copy to `~/dev-vhosts/` on s378)

| Script | Purpose |
|--------|---------|
| `go-live-env.sh` | Public URLs + **sync `EDUAI_API_KEY` from Core → AI Tutor + QM** |
| `go-live-apache.sh` | Install/reload Apache vhosts |
| `go-live-systemd-install.sh` | Install/enable systemd user units |
| `go-live-systemd-start.sh` | Stop tmux, start `eduai-dev.target` |
| `go-live-reset.sh` | **Legacy:** kill ports + restart all **tmux** apps |
| `go-live-restart.sh` / `go-live-start.sh` | Lighter tmux restarts |

Typical order after a code/env change (systemd):

```bash
bash ~/dev-vhosts/go-live-env.sh
systemctl --user restart eduai-dev.target
```

## Shared `EDUAI_API_KEY` (required for extension APIs)

Core and both extension backends must share the **same** service key.

- **Source of truth:** `apps/core/.env` → `EDUAI_API_KEY`
- **Copied by** `go-live-env.sh` into:
  - `apps/extensions/ai-tutor/server/.env`
  - `apps/extensions/question-maker/.env`
- Generate (once) with: `openssl rand -hex 32`
- Core only reads its own `.env` (admin UI overrides do **not** change Core’s key)

### What breaks if the key is missing / mismatched

| Symptom | Cause |
|---------|--------|
| QM: `EduAI service is not configured. Set EDUAI_API_KEY or sign in via Core.` | QM `EDUAI_API_KEY` empty and no usable session cookie forwarded to Core `/api/chat` |
| AI Tutor reconcile / topic sync: `INVALID_SERVICE_KEY` | AI Tutor key ≠ Core key (placeholder `your-eduai-api-key-here` is common) |
| AI Tutor topics empty on imported courses | Topics come from Core via service-key sync; without a valid key, sync never populates local topics |

### How topics work (AI Tutor)

1. For **imported** Core courses, topics live in Core and are pulled with `POST /api/courses/:id/topics/sync` (uses `EDUAI_API_KEY` + `EDUAI_BASE_URL`).
2. `GET /api/courses/:id/topics` only reads the **local** AI Tutor DB — it does not auto-sync.
3. After fixing the key, open the course as instructor and use **Sync topics** (or wait for reconcile once the key matches).
4. For **native** (non-imported) courses, instructors create topics manually in AI Tutor.

### How question generation works (Question Maker)

1. QM backend calls Core `POST /api/chat`.
2. Auth preference: **forwarded Core session cookie first**; `Authorization: Bearer <EDUAI_API_KEY>` only if no cookie (server-only jobs).
3. Core still needs a working model provider key (e.g. `GOOGLE_GENERATIVE_AI_API_KEY` in Core `.env`).
4. Interactive AI therefore works with shared-cookie login alone; keep `EDUAI_API_KEY` for topic sync / reconcile / cascade, not for day-to-day chat.
5. Core must receive generation instructions via top-level `systemPrompt` (not `messages[].role=system`, which Core strips). Empty course-RAG refusals are skipped when a custom `systemPrompt` is set.

## Shared session cookie

- Set `COOKIE_DOMAIN=.eduai.ok.ubc.ca` on Core (done by `go-live-env.sh`).
- After enabling that, users must **sign in again** so the cookie is issued with the shared domain.
- Extensions redirect to Core login with `?force=1` to avoid a host-only-cookie redirect loop.

## Smoke checks

```bash
# Ports (on s378)
curl -s -o /dev/null -w 'core:%{http_code} at:%{http_code} qm:%{http_code}\n' \
  http://127.0.0.1:3000/ http://127.0.0.1:3001/ http://127.0.0.1:5173/

# systemd
systemctl --user is-active eduai-core eduai-aitutor-fe eduai-qm-frontend

# Key presence only (never print the value)
grep -c '^EDUAI_API_KEY=.\+' apps/core/.env \
  apps/extensions/ai-tutor/server/.env \
  apps/extensions/question-maker/.env
```

All three greps should report a non-empty key line. Values must be identical across the three files.
