### How to use the dev server

## Prerequisites
- UBC VPN (or campus network)
- SSH: `ssh YOUR_CWL@dev.eduai.ok.ubc.ca`
- RAG embeddings: set **`EMBEDDING_PROVIDER=local`**, **`OLLAMA_EMBEDDING_MODEL=mxbai-embed-large`**, and **`OLLAMA_BASE_URL`** in `apps/core/.env` (Ollama runs on cmps01). Pull the model once: `ollama pull mxbai-embed-large`. For laptop dev without Ollama, use **`EMBEDDING_PROVIDER=cloud`** plus **`OPENROUTER_API_KEY`** or **`OPENAI_API_KEY`** (local mode does not silently fall back to cloud). Verify with `npm run test:embedding` from `apps/core`. After the LOCAL-EMBEDDINGS migration, re-embed courses with `npm run re-embed:course -- <courseId>`. See [`EMBEDDINGS.md`](./EMBEDDINGS.md) and [`LOCAL-EMBEDDINGS.md`](./LOCAL-EMBEDDINGS.md).

## Use the app
Open https://dev.eduai.ok.ubc.ca

#### SSH to the server

```bash
ssh YOUR_CWL@dev.eduai.ok.ubc.ca
```

You must be on **UBC VPN** or campus network.

#### Switch dev server to your feature branch

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
git fetch origin
git checkout [your-feature-branch]      # or your feature branch merged with development
git pull origin [your-feature-branch]
npm install   # if dependencies changed
cd apps/core && npx prisma generate && npx prisma migrate deploy
```

**Changing embedding dimension on the shared dev server:** if your branch uses a different `vector(N)` than the DB currently has, follow [How to change vector dimensionality](./EMBEDDINGS.md#how-to-change-vector-dimensionality) before re-embedding.

After switching branches, refresh your browser tab changes should reflect because
there is not reload

If it doesn't however, follow these steps

```bash
tmux new -s eduai
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
npm run docker:dev:db:eduai
npx turbo run dev --filter=edu-ai
```

Detach: `Ctrl+B`, then `D`. Reattach: `tmux attach -t eduai`.


#### Start the dev server (use tmux)

The server process **dies when your SSH session ends**. Use `tmux` so it survives disconnects:



| Command                      | What it does                         |
| ---------------------------- | ------------------------------------ |
| `tmux ls`                    | List active sessions                 |
| `tmux attach -t eduai`       | Reattach to the `eduai` session      |
| `tmux kill-session -t eduai` | Kill the session and stop the server |
| `Ctrl+B` then `D`            | Detach (server keeps running)        |
| `Ctrl+C` (inside tmux)       | Stop the dev process                 |

Apache proxies `https://dev.eduai.ok.ubc.ca` → `http://127.0.0.1:3000`.

#### cmps01 inference (Ollama + vLLM)

Local **chat** models run on **cmps01**; the dev app calls them over **HTTP** (not SSH). See [ARCHITECTURE.md](../ARCHITECTURE.md#cmps01-gpu-inference-host).

Add to `apps/core/.env` on **s378**:

```env
# Ollama — works today from dev
OLLAMA_BASE_URL="http://cmps01.ok.ubc.ca:11434"

# vLLM — LiteLLM proxy on cmps01 (TCP 8001 open dev → cmps01)
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Restart dev server (tmux) after editing `.env`.

| Check | Command (on dev) |
| ----- | ---------------- |
| Ollama reachable | `curl -s http://cmps01.ok.ubc.ca:11434/api/tags \| head` |
| vLLM models | `curl -s http://cmps01.ok.ubc.ca:8001/v1/models -H "Authorization: Bearer vllm-local" \| jq '.data[].id'` |
| vLLM chat smoke | `cd apps/core && npm run vllm:smoke` |
| SSH dev → cmps01 | **Fails** (port 22 timeout) — **do not** use SSH tunnel from s378 |

**vLLM ops on cmps01 (LiteLLM + two backends):** [`VLLM.md`](./VLLM.md) · [`infra/cmps01/README.md`](../../infra/cmps01/README.md)

In the app: pick **`vllm:qwen2.5-7b-instruct`** or **`vllm:qwen2.5-32b-instruct`** in chat (no browser enable step). Register models in **Admin → AI Models** (vLLM provider → **Refresh list**); `npx prisma db seed` only adds the `vllm` provider row.

#### Auth / login troubleshooting

Required in `apps/core/.env` on the server:

```env
BETTER_AUTH_URL="https://dev.eduai.ok.ubc.ca"
BETTER_AUTH_SECRET="<openssl rand -base64 32>"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54320/eduai?schema=public"
```

After a DB reset, **register a new account** — old passwords are gone.

**Silent login (page reloads, no error):** usually session cookies not stored. Check:

1. Restart dev server after `.env` changes.
2. Browser DevTools → Network → POST `/auth/login` → Response headers: expect **multiple** `Set-Cookie` with `Secure` on HTTPS.
3. From SSH, smoke-test the auth API:

```bash
curl -si -X POST "https://dev.eduai.ok.ubc.ca/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}' | head -40
```

`401` = wrong credentials. `200` with `Set-Cookie` but browser still fails → cookie `Secure` / `Domain` mismatch (ensure `BETTER_AUTH_URL` is `https://…`, not `localhost`).

Do **not** set `COOKIE_DOMAIN` on the shared dev host unless you intend cross-subdomain cookies (production uses e.g. `.eduai.ok.ubc.ca`).

**Can’t log in again after logout:** use **Log out** in the UI (server `POST /auth/logout`), not only client-side sign-out. Clear site cookies for `dev.eduai.ok.ubc.ca` once if a stale `__Secure-better-auth.session_token` remains. Verify sign-out clears cookies:

```bash
curl -si -X POST "https://dev.eduai.ok.ubc.ca/api/auth/sign-out" \
  -H "Cookie: __Secure-better-auth.session_token=YOUR_TOKEN" | head -20
```

#### When you're done

Switch back to `development` (or `main`) so the server is in a known state for others:

```bash
tmux attach -t eduai
# Ctrl+C to stop, then:
git checkout development
git pull origin development
npm install
npm run docker:dev:db:eduai
cd apps/core && npx prisma generate && npx prisma migrate deploy
npx turbo run dev --filter=edu-ai
```

If your branch changed embedding dimension, revert the shared DB and `.env` for the branch you return to — see [How to change vector dimensionality](./EMBEDDINGS.md#how-to-change-vector-dimensionality) (section **Switching back**).

Detach again with `Ctrl+B`, `D`.
