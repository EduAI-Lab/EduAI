# s378 extension hosting (dev)

s378 serves **built** assets. It does not run `npm run dev`.

| Host | Served by |
|------|-----------|
| `https://dev.eduai.ok.ubc.ca` | Core `:3000` (node, SSR) |
| `https://dev.aitutor.eduai.ok.ubc.ca` | **Apache, static** from `apps/extensions/ai-tutor/build/client`; `/api/` → `:4000` |
| `https://dev.questionmaker.eduai.ok.ubc.ca` | **Apache, static** from `apps/extensions/question-maker/app/frontend/dist`; `/api/` → `:8000` |

Both extension frontends are `ssr: false`, so a build emits plain static files and
Apache serves them directly — there is no Vite process on `:3001` or `:5173` any
more. Core stays a node process because it is SSR.

> **A `git pull` no longer changes what dev serves, and neither does restarting a
> unit.** Every deploy is `git pull` → `go-live-build.sh`. See **Rebuilding** below.

## Process management

Four **system** units, owned by the `eduai-dev` group:

| Unit | Port |
|------|------|
| `eduai-core.service` | `:3000` |
| `eduai-cron-worker.service` | no HTTP port; runs scheduled jobs |
| `eduai-aitutor-server.service` | `:4000` |
| `eduai-qm-backend.service` | `:8000` |
| `eduai-dev.target` | starts/stops all four |

These are system units, not `systemctl --user` units, so **any** `eduai-dev`
member can restart the stack — no `loginctl enable-linger`, no being locked to
one account, and no sudo (a polkit rule in `systemd/49-eduai-dev.rules` grants
the group lifecycle control over `eduai-*` units).

### One-time install on s378

For a new host, run the installer before the first build. Existing hosts upgrading
to the dedicated cron worker must also rerun it once so
`eduai-cron-worker.service` is installed and enabled.

```bash
sudo useradd -r -s /bin/false eduai-cron          # once, if absent
sudo usermod -a -G eduai-dev eduai-cron           # lets the worker read shared env
bash infra/s378/go-live-systemd-install.sh   # needs sudo; run once
bash infra/s378/go-live-build.sh             # build + start
```

The installer copies `infra/cron/*.sh` to `/opt/eduai/cron` with
`eduai-cron:eduai-cron` ownership and `0750` mode. The production cron secrets
file must be readable by the worker but no other users:
`sudo chown root:eduai-cron /etc/eduai/cron.env && sudo chmod 640 /etc/eduai/cron.env`.

### Day-to-day

```bash
systemctl status eduai-dev.target
systemctl restart eduai-dev.target       # all four — no sudo, no --user
systemctl restart eduai-aitutor-server   # one app
journalctl -u eduai-core -f              # logs
systemctl status eduai-cron-worker.service
journalctl -u eduai-cron-worker.service -f
```

Restarting picks up **server-side** `.env` changes. A `VITE_`-prefixed value is
baked into the bundle at build time, so changing one needs a rebuild, not a
restart.

## Rebuilding

> **Order matters: `env` → `build` → `restart`.** Never `env` → `restart`.
> `go-live-env.sh` rewrites the public `VITE_*` URLs, and those are now compiled
> into the bundle. Skip the build and the sites keep serving the previous run's
> URLs. `go-live-build.sh` enforces this order for you.

```bash
git pull
bash infra/s378/go-live-build.sh              # env, generate, migrate, seed, build, restart
bash infra/s378/go-live-build.sh --install    # after a branch switch (adds npm install)
bash infra/s378/go-live-build.sh --only qm    # core | aitutor | qm
                                              # (ai-tutor / question-maker also accepted)
```

A full build takes roughly 1–3 minutes. `vite build` empties the output directory
first, so the two extension sites return 404 briefly mid-build. That is expected.

There is no HMR on s378 — nobody develops on this box, and the tree-shaken build
is the entire point (the dev server shipped ~12MB of unbundled JS per page).

## Scripts

| Script | Purpose |
|--------|---------|
| `go-live-build.sh` | **The deploy command.** env → generate → migrate → seed → build → restart |
| `go-live-env.sh` | Public URLs + **sync `EDUAI_API_KEY` from Core → AI Tutor + QM** |
| `go-live-apache.sh` | Install/reload the Apache vhosts **from this repo** (needs sudo; rare) |
| `go-live-systemd-install.sh` | Install/enable the system units + polkit rule (needs sudo; once) |

> `~/dev-vhosts/` is **legacy and no longer a source of truth.** The vhosts and
> units tracked in `infra/s378/` are what get installed; edit them here.

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
# Public hosts (all three should be 200)
for h in dev.eduai dev.aitutor.eduai dev.questionmaker.eduai; do
  printf '%s -> ' "$h"; curl -sk -o /dev/null -w '%{http_code}\n' "https://$h.ok.ubc.ca/"
done

# systemd — four units, and nothing left under --user
systemctl is-active eduai-core eduai-cron-worker eduai-aitutor-server eduai-qm-backend
systemctl status eduai-cron-worker.service --no-pager
journalctl -u eduai-cron-worker.service -n 50 --no-pager
systemctl --user list-units 'eduai*'        # expect empty
pgrep -af 'nodemon|vite|react-router dev'   # expect empty

# Built assets, not a dev server
curl -sk https://dev.questionmaker.eduai.ok.ubc.ca/ | grep -o 'src="[^"]*"'
#   expect src="/assets/index-<hash>.js", NOT src="/src/main.tsx"
curl -sk https://dev.aitutor.eduai.ok.ubc.ca/ | grep -c '@vite/client'   # expect 0

# Dev semantics survived the build (NODE_ENV=development reached the bundler)
grep -rls 'localhost:8080' apps/extensions/question-maker/app/frontend/dist/assets | head -1
#   present => import.meta.env.DEV baked true

# Server-side NODE_ENV, i.e. Core's isProd gates are off
systemctl show eduai-core -p Environment --value | tr ' ' '\n' | grep NODE_ENV
curl -sI http://127.0.0.1:3000/ | grep -i strict-transport   # expect NOTHING from Core
#   Check Core DIRECTLY on :3000. Do NOT check the public URL for this — Apache
#   sets Strict-Transport-Security on every vhost on this box, including the two
#   static extension sites that have no node process at all, so the public header
#   is always present and tells you nothing about NODE_ENV.

# Key presence only (never print the value)
grep -c '^EDUAI_API_KEY=.\+' apps/core/.env \
  apps/extensions/ai-tutor/server/.env \
  apps/extensions/question-maker/.env
```

All three greps should report a non-empty key line. Values must be identical across the three files.
