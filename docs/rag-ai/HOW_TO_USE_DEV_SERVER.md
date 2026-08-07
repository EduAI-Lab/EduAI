### How to use the shared s378 / `dev.eduai` server

## Prerequisites
- UBC VPN (or campus network)
- SSH: `ssh YOUR_CWL@s378.ok.ubc.ca` (same host as `dev.eduai.ok.ubc.ca`)
- RAG embeddings: set **`EMBEDDING_PROVIDER=local`**, **`OLLAMA_EMBEDDING_MODEL=mxbai-embed-large`**, and **`OLLAMA_BASE_URL`** in `apps/core/.env` (Ollama runs on cmps01). Pull the model once: `ollama pull mxbai-embed-large`. For laptop dev without Ollama, use **`EMBEDDING_PROVIDER=cloud`** plus **`OPENROUTER_API_KEY`** or **`OPENAI_API_KEY`** (local mode does not silently fall back to cloud). Verify with `npm run test:embedding` from `apps/core`. After the LOCAL-EMBEDDINGS migration, re-embed courses with `npm run re-embed:course -- <courseId>`. See [`EMBEDDINGS.md`](./EMBEDDINGS.md) and [`LOCAL-EMBEDDINGS.md`](./LOCAL-EMBEDDINGS.md).

## Public URLs

| App | URL | Served by |
|-----|-----|-----------|
| Core | https://dev.eduai.ok.ubc.ca | `:3000` (node, SSR) |
| AI Tutor | https://dev.aitutor.eduai.ok.ubc.ca | Apache, **static build**; `/api/` → `:4000` |
| Question Maker | https://dev.questionmaker.eduai.ok.ubc.ca | Apache, **static build**; `/api/` → `:8000` |

> s378 serves **built** assets — it does not run `npm run dev`. A `git pull` or a
> unit restart no longer changes what the sites serve; you must rebuild. See
> [Switch the shared server to your feature branch](#switch-the-shared-server-to-your-feature-branch).

Shared session cookies use **`COOKIE_DOMAIN=.eduai.ok.ubc.ca`** so login on Core works across extension hosts. After that env is enabled (or changed), **sign in again** (extensions send `?force=1` on login to avoid a redirect loop).

Ops details for extensions + env sync: [`infra/s378/GO-LIVE.md`](../../infra/s378/GO-LIVE.md).

## Process management (systemd)

Three **system** units owned by the `eduai-dev` group. Units live in
`infra/s378/systemd/`. Any group member can restart the stack — no `--user`, no
`loginctl enable-linger`, no sudo.

| Unit | Port |
|------|------|
| `eduai-core.service` | `:3000` |
| `eduai-aitutor-server.service` | `:4000` |
| `eduai-qm-backend.service` | `:8000` |
| `eduai-dev.target` | all three |

The two frontend units are gone. Both extension frontends are `ssr: false`, so
their builds are static files that Apache serves directly.

### One-time setup

```bash
bash infra/s378/go-live-systemd-install.sh   # needs sudo; run once
bash infra/s378/go-live-build.sh             # build + start
```

### Day-to-day

```bash
systemctl status eduai-dev.target
systemctl restart eduai-dev.target          # all three
systemctl restart eduai-core                # Core only
journalctl -u eduai-core -f                 # logs

# After a server-side .env change (DATABASE_URL, API keys, …):
bash infra/s378/go-live-env.sh
systemctl restart eduai-dev.target
```

**A `VITE_`-prefixed value is different**: it is compiled into the bundle at build
time, so changing one needs a full rebuild, not a restart:

```bash
bash infra/s378/go-live-build.sh
```

**503 Service Unavailable** from Apache means the node process behind `/api/` (or
Core) is down or still starting:

```bash
systemctl is-active eduai-core eduai-aitutor-server eduai-qm-backend
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
systemctl restart --no-block eduai-core
```

**403 or a blank page on an extension host** is a different failure — that side is
static now, so it usually means the build output is missing or unreadable:

```bash
ls apps/extensions/ai-tutor/build/client/index.html
ls apps/extensions/question-maker/app/frontend/dist/index.html
bash infra/s378/go-live-build.sh    # rebuild if either is absent
```

## Switch the shared server to your feature branch

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
git fetch origin
git checkout [your-feature-branch]
git pull origin [your-feature-branch]
bash infra/s378/go-live-build.sh --install
```

`--install` runs `npm install` first; drop it if dependencies did not change. The
script handles migrations, `prisma generate`, the builds and the restart in the
required order — you do not need to run those by hand.

**Changing embedding dimension on the shared server:** if your branch uses a different `vector(N)` than the DB currently has, follow [How to change vector dimensionality](./EMBEDDINGS.md#how-to-change-vector-dimensionality) before re-embedding.

After the build finishes, hard-refresh the browser.

## Why there's no HMR

s378 serves compiled bundles, so nothing live-reloads and a restart alone will not
show your changes — **you must rebuild.** This is deliberate. The old setup ran
`npm run dev` for every app, which served unbundled ESM: roughly 12MB of JavaScript
across ~250 requests per page, with the `@tabler/icons-react` barrel alone landing
as a single 3.79MB module. Building serves the same routes in a fraction of that.

Nobody develops on this box — it is shared staging — so there was no HMR worth
keeping. Develop locally with `npm run dev`, which is unchanged.

The build still runs with `NODE_ENV=development`, so s378 remains a development
environment in every way the application code can observe: error boundaries still
show stack traces, dev-only routes stay registered, and Core's HSTS and strict
nonce CSP stay off.

## cmps01 inference (Ollama + vLLM)

Local **chat** models run on **cmps01**; the app calls them over **HTTP** (not SSH). See [ARCHITECTURE.md](../ARCHITECTURE.md#cmps01-gpu-inference-host).

Add to `apps/core/.env` on **s378**:

```env
# Ollama — works today from dev
OLLAMA_BASE_URL="http://cmps01.ok.ubc.ca:11434"

# vLLM — LiteLLM proxy on cmps01 (TCP 8001 open dev → cmps01)
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Restart after editing `.env`: `systemctl restart eduai-core`.

| Check | Command (on s378) |
| ----- | ----------------- |
| Ollama reachable | `curl -s http://cmps01.ok.ubc.ca:11434/api/tags \| head` |
| vLLM models | `curl -s http://cmps01.ok.ubc.ca:8001/v1/models -H "Authorization: Bearer vllm-local" \| jq '.data[].id'` |
| vLLM chat smoke | `cd apps/core && npm run vllm:smoke` |
| SSH s378 → cmps01 | **Fails** (port 22 timeout) — **do not** use an SSH tunnel from s378 |

**vLLM ops on cmps01:** [`VLLM.md`](./VLLM.md) · [`infra/cmps01/README.md`](../../infra/cmps01/README.md)

In the app: pick **`vllm:qwen2.5-7b-instruct`** or **`vllm:qwen2.5-32b-instruct`** in chat. Register models in **Admin → AI Models** (vLLM provider → **Refresh list**); `npx prisma db seed` only adds the `vllm` provider row.

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

1. Restart Core after `.env` changes: `systemctl restart eduai-core`.
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

**Shared `EDUAI_API_KEY`:** Core and extension backends must match (topic sync / reconcile). Sync with `bash infra/s378/go-live-env.sh`. Interactive QM AI chat prefers the session cookie; see [`infra/s378/GO-LIVE.md`](../../infra/s378/GO-LIVE.md).

## When you're done

Switch the shared tree back to `development` (or the agreed default) so others have a known state:

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
git checkout development
git pull origin development
bash infra/s378/go-live-build.sh --install
```

Leaving the tree on `development` without rebuilding would keep serving **your
branch's** compiled assets, so the rebuild is not optional here.

If your branch changed embedding dimension, revert the shared DB and `.env` for the branch you return to — see [How to change vector dimensionality](./EMBEDDINGS.md#how-to-change-vector-dimensionality) (section **Switching back**).
